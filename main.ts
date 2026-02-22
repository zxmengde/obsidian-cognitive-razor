/** Cognitive Razor - 公理化知识管理插件主入口 */

import { Plugin, Notice } from 'obsidian';
import type { PluginSettings } from './src/types';

// 数据层组件
import { SettingsStore, DEFAULT_SETTINGS } from './src/data/settings-store';
import { FileStorage } from './src/data/file-storage';
import { Logger } from './src/data/logger';
import { Validator } from './src/data/validator';

// 国际化
import { I18n } from './src/core/i18n';

// 应用层组件
import { CruidCache } from './src/core/cruid-cache';
import { VectorIndex } from './src/core/vector-index';
import { SimpleLockManager } from './src/core/lock-manager';
import { ProviderManager } from './src/core/provider-manager';
import { PromptManager } from './src/core/prompt-manager';
import { DuplicateManager } from './src/core/duplicate-manager';
import { TaskQueue } from './src/core/task-queue';
import { TaskRunner } from './src/core/task-runner';

import { CreateOrchestrator } from './src/core/create-orchestrator';
import { VerifyOrchestrator } from './src/core/verify-orchestrator';
import { ExpandOrchestrator } from './src/core/expand-orchestrator';
// ServiceContainer
import { ServiceContainer } from './src/core/service-container';
import { NoteRepository } from './src/core/note-repository';
import { ContentRenderer } from './src/core/content-renderer';
import { schemaRegistry } from './src/core/schema-registry';
import type { OrchestratorDeps } from './src/core/orchestrator-deps';

// UI 层组件（Svelte 5）
import { WorkbenchView, VIEW_TYPE_CR_WORKBENCH } from './src/ui/svelte/workbench-view';
import { CRSettingTab } from './src/ui/svelte/settings-tab';
import { CommandDispatcher } from './src/ui/command-dispatcher';
import { ModalManager } from './src/ui/modal-manager';

// ============================================================================
// 服务 Token 定义
// ============================================================================

/** 服务标识符，用于 ServiceContainer 注册与解析 */
export const SERVICE_TOKENS = {
	// Data 层
	fileStorage: Symbol('FileStorage'),
	logger: Symbol('Logger'),
	settingsStore: Symbol('SettingsStore'),
	validator: Symbol('Validator'),

	// Core 层
	i18n: Symbol('I18n'),
	cruidCache: Symbol('CruidCache'),
	vectorIndex: Symbol('VectorIndex'),
	lockManager: Symbol('LockManager'),
	providerManager: Symbol('ProviderManager'),
	promptManager: Symbol('PromptManager'),
	duplicateManager: Symbol('DuplicateManager'),
	taskRunner: Symbol('TaskRunner'),
	taskQueue: Symbol('TaskQueue'),
	createOrchestrator: Symbol('CreateOrchestrator'),
	verifyOrchestrator: Symbol('VerifyOrchestrator'),
	expandOrchestrator: Symbol('ExpandOrchestrator'),

	// UI 层
	modalManager: Symbol('ModalManager'),
	commandDispatcher: Symbol('CommandDispatcher'),
} as const;

// ============================================================================
// 插件主类
// ============================================================================

/** Cognitive Razor 插件主类 */
export default class CognitiveRazorPlugin extends Plugin {
	/** 服务容器 */
	private container!: ServiceContainer;

	// 设置（保留公开属性，供 SettingsTab 等 UI 组件访问）
	settings!: PluginSettings;
	settingsStore!: SettingsStore;

	// 事件取消订阅列表
	private unsubscribers: Array<() => void> = [];

	// 网络离线状态
	private isOffline = false;

	/** 插件加载 — 仅负责组装、启动和错误边界 */
	async onload() {
		try {
			this.container = new ServiceContainer();
			// 仅初始化 Data 层和加载设置（轻量同步操作）
			// 耗时的 Core/UI 层初始化延迟到 workspace.onLayoutReady() 之后
			await this.initializeDataLayerOnly();

			this.app.workspace.onLayoutReady(() => {
				void this.initializeAfterLayout();
			});
		} catch (error) {
			this.showSafeMode(error);
		}
	}

	/**
	 * 外部设置变更回调 (Obsidian 1.5.7+)
	 * 当 data.json 被外部修改时触发（如 Obsidian Sync）
	 */
	async onExternalSettingsChange(): Promise<void> {
		const logger = this.tryResolve<Logger>(SERVICE_TOKENS.logger);
		logger?.info('CognitiveRazorPlugin', '检测到外部设置变更，重新加载设置');

		try {
			const loadResult = await this.settingsStore.loadSettings();
			if (loadResult.ok) {
				this.settings = this.settingsStore.getSettings();
				logger?.debug('CognitiveRazorPlugin', '外部设置变更已加载');
			}
		} catch (error) {
			logger?.error('CognitiveRazorPlugin', '重新加载设置失败', error as Error);
		}
	}

	/**
	 * 插件卸载 — 委托 ServiceContainer 逆序释放资源
	 */
	async onunload() {
		const logger = this.tryResolve<Logger>(SERVICE_TOKENS.logger);
		logger?.info('CognitiveRazorPlugin', '开始卸载插件');

		try {
			// 1. 暂停任务队列
			const taskQueue = this.tryResolve<TaskQueue>(SERVICE_TOKENS.taskQueue);
			if (taskQueue) {
				await taskQueue.pause();
				taskQueue.stop();
				await taskQueue.dispose();
				logger?.debug('CognitiveRazorPlugin', '任务队列已暂停并停止调度器');
			}

			// 2. 停止管线编排器和缓存
			this.tryResolve<CreateOrchestrator>(SERVICE_TOKENS.createOrchestrator)?.dispose();
			this.tryResolve<VerifyOrchestrator>(SERVICE_TOKENS.verifyOrchestrator)?.dispose();
			this.tryResolve<CruidCache>(SERVICE_TOKENS.cruidCache)?.dispose();

			// 3. 视图由 Obsidian 工作区自动管理，onunload 不主动 detach
			logger?.debug('CognitiveRazorPlugin', '视图由 Obsidian 工作区自动管理');

			// 4. 解除所有订阅
			for (const unsub of this.unsubscribers) {
				try {
					unsub();
				} catch (e) {
					logger?.warn('CognitiveRazorPlugin', '取消订阅时出错', { error: e });
				}
			}
			this.unsubscribers = [];

			// 5. 刷新 Logger 防抖缓冲区（确保所有日志写入磁盘）
			if (logger) {
				await logger.flush();
			}

			// 6. 释放 ServiceContainer 中所有服务
			await this.container?.disposeAll();

			logger?.info('CognitiveRazorPlugin', '插件卸载完成');
		} catch (error) {
			// 卸载阶段不使用 console.error，通过 Logger 记录（如果可用）
			logger?.error('CognitiveRazorPlugin', '插件卸载失败', error as Error);
		}
	}

	// ========================================================================
	// 初始化流程（委托给 ServiceContainer）
	// ========================================================================

	/**
	 * Data 层初始化（onload 中执行，轻量且必要）
	 * 仅初始化 Data 层和加载设置，不执行耗时操作
	 */
	private async initializeDataLayerOnly(): Promise<void> {
		// ---- Data 层 ----
		await this.registerDataLayer();

		// 加载设置
		await this.loadSettings();
	}

	/**
	 * Layout Ready 后的完整初始化（Core + UI + 事件订阅）
	 * 耗时操作（向量加载、缓存构建等）在此阶段执行，不阻塞 Obsidian 启动
	 */
	private async initializeAfterLayout(): Promise<void> {
		try {
			const logger = this.container.resolve<Logger>(SERVICE_TOKENS.logger);

			logger.info('CognitiveRazorPlugin', 'Cognitive Razor 插件初始化开始（Layout Ready）', {
				event: 'PLUGIN_INIT',
				version: this.manifest.version,
				minAppVersion: this.manifest.minAppVersion
			});

			// ---- Core 层 ----
			await this.registerCoreLayer();

			// ---- UI 层 ----
			this.registerUILayer();

			// ---- 事件订阅 ----
			this.subscribeToEvents();

			logger.info('CognitiveRazorPlugin', 'Cognitive Razor 插件初始化完成', {
				event: 'PLUGIN_INIT_COMPLETE',
				version: this.manifest.version,
				logLevel: this.settings.logLevel
			});
		} catch (error) {
			this.showSafeMode(error);
		}
	}

	/**
	 * 注册并初始化 Data 层服务
	 * 如果此层失败，将抛出异常触发安全模式
	 */
	private async registerDataLayer(): Promise<void> {
		// 1. 初始化数据目录
		await this.initializeDataDirectory();

		// 2. FileStorage（使用 manifest.dir 确保路径与实际插件目录一致）
		const pluginDir = this.manifest.dir;
		const fileStorage = new FileStorage(this.app.vault, pluginDir);
		const initResult = await fileStorage.initialize();
		if (!initResult.ok) {
			throw new Error(`FileStorage 初始化失败: ${initResult.error.message}`);
		}
		this.container.registerInstance(SERVICE_TOKENS.fileStorage, fileStorage, 'data');

		// 恢复未完成的原子写入残留文件
		const recoveryResult = await fileStorage.recoverIncompleteWrites();
		if (recoveryResult.ok && recoveryResult.value > 0) {
			console.info(`[CR] 恢复了 ${recoveryResult.value} 个未完成写入的文件`);
		}

		// 3. Logger
		const logFilePath = 'data/app.log';
		const initialLogLevel = this.settings?.logLevel || DEFAULT_SETTINGS.logLevel;
		const logger = new Logger(
			logFilePath,
			{
				write: async (path: string, content: string) => {
					const result = await fileStorage.write(path, content);
					if (!result.ok) {
						throw new Error(`写入日志文件失败: ${result.error.message}`);
					}
				},
				read: async (path: string) => {
					const result = await fileStorage.read(path);
					if (!result.ok) {
						if (result.error.code === 'E300') return '';
						throw new Error(`读取日志文件失败: ${result.error.message}`);
					}
					return result.value;
				},
				exists: async (path: string) => {
					return await fileStorage.exists(path);
				}
			},
			initialLogLevel
		);
		await logger.initialize();
		this.container.registerInstance(SERVICE_TOKENS.logger, logger, 'data');

		logger.info('CognitiveRazorPlugin', '数据层组件初始化完成');
	}

	/**
	 * 注册并初始化 Core 层服务
	 */
	private async registerCoreLayer(): Promise<void> {
		const logger = this.container.resolve<Logger>(SERVICE_TOKENS.logger);
		const fileStorage = this.container.resolve<FileStorage>(SERVICE_TOKENS.fileStorage);

		logger.info('CognitiveRazorPlugin', '应用层组件初始化开始');

		// 国际化（中文单语）
		const i18n = new I18n();
		i18n.setLogger(logger);
		this.container.registerInstance(SERVICE_TOKENS.i18n, i18n, 'core');
		logger.debug('CognitiveRazorPlugin', 'i18n 初始化完成');

		// CruidCache
		const cruidCache = new CruidCache(this.app, logger, (ref) => this.registerEvent(ref));
		cruidCache.start({ fallbackToRead: false });
		this.container.registerInstance(SERVICE_TOKENS.cruidCache, cruidCache, 'core');
		logger.debug('CognitiveRazorPlugin', 'CruidCache 已启动');

		// VectorIndex
		const embeddingModel = this.settings.taskModels?.index?.model || 'text-embedding-3-small';
		const embeddingDimension = this.settings.taskModels?.index?.embeddingDimension
			?? this.settings.embeddingDimension
			?? 1536;
		const vectorIndex = new VectorIndex(
			fileStorage, embeddingModel, embeddingDimension, logger, cruidCache,
			(cb, ms) => this.registerInterval(window.setInterval(cb, ms))
		);
		const loadResult = await vectorIndex.load();
		if (!loadResult.ok) {
			logger.error('CognitiveRazorPlugin', 'VectorIndex 加载失败', undefined, { error: loadResult.error });
		}
		this.container.registerInstance(SERVICE_TOKENS.vectorIndex, vectorIndex, 'core');
		logger.debug('CognitiveRazorPlugin', 'VectorIndex 初始化完成', { stats: vectorIndex.getStats() });

		// Validator
		const validator = new Validator();
		this.container.registerInstance(SERVICE_TOKENS.validator, validator, 'core');

		// LockManager
		const lockManager = new SimpleLockManager();
		this.container.registerInstance(SERVICE_TOKENS.lockManager, lockManager, 'core');

		// LockManager 全局过期扫描（每 60 秒清理泄漏锁）
		this.registerInterval(window.setInterval(() => lockManager.evictAllExpired(), 60_000));

		// ProviderManager
		const providerManager = new ProviderManager(this.settingsStore, logger);
		const unsubNetwork = providerManager.subscribeNetworkStatus((online, error) => {
			this.handleNetworkStatusChange(online, error?.error?.message);
		});
		this.unsubscribers.push(unsubNetwork);
		this.container.registerInstance(SERVICE_TOKENS.providerManager, providerManager, 'core');
		logger.debug('CognitiveRazorPlugin', 'ProviderManager 初始化完成', {
			providersCount: providerManager.getConfiguredProviders().length
		});

		// PromptManager
		const promptsDir = 'prompts';
		const promptManager = new PromptManager(fileStorage, logger, promptsDir);
		const baseComponentsResult = await promptManager.preloadAllBaseComponents();
		if (!baseComponentsResult.ok) {
			logger.warn('CognitiveRazorPlugin', '基础组件加载失败（非致命错误）', { error: baseComponentsResult.error });
		}
		const preloadResult = await promptManager.preloadAllTemplates();
		if (!preloadResult.ok) {
			logger.error('CognitiveRazorPlugin', 'PromptManager 模板加载失败', undefined, { error: preloadResult.error, promptsDir });
		}
		this.container.registerInstance(SERVICE_TOKENS.promptManager, promptManager, 'core');

		// DuplicateManager
		const duplicateManager = new DuplicateManager(
			vectorIndex, fileStorage, logger, this.settingsStore, lockManager, 'data/duplicate-pairs.json'
		);
		const dupInitResult = await duplicateManager.initialize();
		if (!dupInitResult.ok) {
			logger.error('CognitiveRazorPlugin', 'DuplicateManager 初始化失败', undefined, { error: dupInitResult.error });
		}
		this.container.registerInstance(SERVICE_TOKENS.duplicateManager, duplicateManager, 'core');
		logger.debug('CognitiveRazorPlugin', 'DuplicateManager 初始化完成', {
			pendingPairs: duplicateManager.getPendingPairs().length
		});

		// 订阅删除事件：清理向量索引与重复对
		const unsubDelete = cruidCache.onDelete(({ cruid, path }) => {
			void this.cleanupAfterNoteDeleted(cruid, path);
		});
		this.unsubscribers.push(unsubDelete);

		// TaskRunner
		const taskRunner = new TaskRunner({
			providerManager, promptManager, validator,
			logger, vectorIndex, settingsStore: this.settingsStore, app: this.app
		});
		this.container.registerInstance(SERVICE_TOKENS.taskRunner, taskRunner, 'core');

		// TaskQueue
		const taskQueue = new TaskQueue(lockManager, fileStorage, logger, this.settingsStore, 'data/queue-state.json');
		const queueInitResult = await taskQueue.initialize();
		if (!queueInitResult.ok) {
			logger.error('CognitiveRazorPlugin', 'TaskQueue 初始化失败', undefined, { error: queueInitResult.error });
		}
		taskQueue.setTaskRunner(taskRunner);
		this.container.registerInstance(SERVICE_TOKENS.taskQueue, taskQueue, 'core');
		logger.debug('CognitiveRazorPlugin', 'TaskQueue 初始化完成', { status: taskQueue.getStatus() });

		// NoteRepository + ContentRenderer（Orchestrator 共享依赖）
		const noteRepository = new NoteRepository(this.app, logger);
		const contentRenderer = new ContentRenderer();

		// OrchestratorDeps：所有独立编排器共享的依赖对象
		const orchestratorDeps: OrchestratorDeps = {
			app: this.app, noteRepository, taskQueue, taskRunner, vectorIndex,
			duplicateManager, lockManager, promptManager,
			contentRenderer, schemaRegistry, settingsStore: this.settingsStore,
			cruidCache, logger, providerManager,
		};

		// CreateOrchestrator
		const createOrchestrator = new CreateOrchestrator(orchestratorDeps);
		this.container.registerInstance(SERVICE_TOKENS.createOrchestrator, createOrchestrator, 'core');

		// VerifyOrchestrator
		const verifyOrchestrator = new VerifyOrchestrator(orchestratorDeps);
		this.container.registerInstance(SERVICE_TOKENS.verifyOrchestrator, verifyOrchestrator, 'core');

		// ExpandOrchestrator
		const expandOrchestrator = new ExpandOrchestrator(orchestratorDeps, {
			createOrchestrator, fileStorage
		});
		this.container.registerInstance(SERVICE_TOKENS.expandOrchestrator, expandOrchestrator, 'core');

		logger.info('CognitiveRazorPlugin', '应用层组件初始化完成');
	}

	/**
	 * 注册 UI 层服务
	 */
	private registerUILayer(): void {
		const logger = this.container.resolve<Logger>(SERVICE_TOKENS.logger);
		const taskQueue = this.container.resolve<TaskQueue>(SERVICE_TOKENS.taskQueue);

		logger.debug('CognitiveRazorPlugin', '开始初始化 UI 层');

		// 注册视图
		this.registerViews();

		// ModalManager（需在其他 UI 组件之前初始化，供它们注入使用）
		const modalManager = new ModalManager({ logger });
		this.container.registerInstance(SERVICE_TOKENS.modalManager, modalManager, 'ui');
		logger.debug('CognitiveRazorPlugin', 'ModalManager 初始化完成');

		// CommandDispatcher
		const commandDispatcher = new CommandDispatcher(this, taskQueue);
		commandDispatcher.registerAllCommands();
		this.container.registerInstance(SERVICE_TOKENS.commandDispatcher, commandDispatcher, 'ui');
		logger.debug('CognitiveRazorPlugin', '命令注册完成');

		// 设置面板（Svelte 5）
		this.addSettingTab(new CRSettingTab(this.app, this));

		logger.info('CognitiveRazorPlugin', 'UI 层初始化完成');
	}

	// ========================================================================
	// 安全模式
	// ========================================================================

	/**
	 * 安全模式：Data 层初始化失败时仅显示错误信息和设置入口
	 * 不加载 Core 和 UI 层
	 *
	 * @see 需求 20.2, 20.3
	 */
	private showSafeMode(error: unknown): void {
		const errorMessage = error instanceof Error ? error.message : String(error);

		// 通过 Logger 记录（如果 Logger 已初始化）
		const logger = this.tryResolve<Logger>(SERVICE_TOKENS.logger);
		if (logger) {
			logger.error('CognitiveRazorPlugin', '插件进入安全模式', error as Error, {
				event: 'SAFE_MODE'
			});
		}

		// 显示用户友好的错误通知
		new Notice(`Cognitive Razor 初始化失败，已进入安全模式: ${errorMessage}`, 10000);

		// 仅注册设置面板，允许用户修改配置
		this.addSettingTab(new CRSettingTab(this.app, this));
	}

	// ========================================================================
	// 辅助方法
	// ========================================================================

	/**
	 * 安全解析服务（容器未初始化或服务未注册时返回 undefined）
	 */
	private tryResolve<T>(token: symbol): T | undefined {
		try {
			return this.container?.resolve<T>(token);
		} catch {
			return undefined;
		}
	}

	/**
	 * 初始化数据目录结构（使用 manifest.dir 确保路径正确）
	 */
	private async initializeDataDirectory(): Promise<void> {
		const dataDir = `${this.manifest.dir}/data`;
		const adapter = this.app.vault.adapter;
		const directories = [
			dataDir,
			`${dataDir}/vectors`,
			`${dataDir}/vectors/Domain`,
			`${dataDir}/vectors/Issue`,
			`${dataDir}/vectors/Theory`,
			`${dataDir}/vectors/Entity`,
			`${dataDir}/vectors/Mechanism`
		];

		for (const dir of directories) {
			const exists = await adapter.exists(dir);
			if (!exists) {
				await adapter.mkdir(dir);
			}
		}
	}

	/**
	 * 加载设置
	 */
	private async loadSettings(): Promise<void> {
		const logger = this.container.resolve<Logger>(SERVICE_TOKENS.logger);
		logger.info('CognitiveRazorPlugin', '开始加载设置');

		this.settingsStore = new SettingsStore(this);
		const loadResult = await this.settingsStore.loadSettings();
		if (!loadResult.ok) {
			logger.error('CognitiveRazorPlugin', '加载设置失败', undefined, { error: loadResult.error });
			this.settings = { ...DEFAULT_SETTINGS };
			logger.warn('CognitiveRazorPlugin', '使用默认设置');
		} else {
			this.settings = this.settingsStore.getSettings();
			logger.info('CognitiveRazorPlugin', '设置加载成功', {
				version: this.settings.version,
				providersCount: Object.keys(this.settings.providers).length
			});
		}

		// 注册 SettingsStore 到 ServiceContainer（Data 层）
		this.container.registerInstance(SERVICE_TOKENS.settingsStore, this.settingsStore, 'data');

		// 同步日志级别
		if (this.settings.logLevel) {
			logger.setLogLevel(this.settings.logLevel);
			logger.debug('CognitiveRazorPlugin', '日志配置已同步', { logLevel: this.settings.logLevel });
		}
	}

	/**
	 * 注册视图
	 */
	private registerViews(): void {
		const logger = this.container.resolve<Logger>(SERVICE_TOKENS.logger);
		logger.debug('CognitiveRazorPlugin', '开始注册视图');

		// 工作台视图（Svelte 5）
		this.registerView(
			VIEW_TYPE_CR_WORKBENCH,
			(leaf) => {
				const view = new WorkbenchView(leaf, this);
				logger.debug('CognitiveRazorPlugin', 'WorkbenchView 视图已创建');
				return view;
			}
		);

		logger.info('CognitiveRazorPlugin', '视图注册完成', { views: [VIEW_TYPE_CR_WORKBENCH] });
	}

	/**
	 * 订阅事件
	 */
	private subscribeToEvents(): void {
		const logger = this.container.resolve<Logger>(SERVICE_TOKENS.logger);
		const taskQueue = this.container.resolve<TaskQueue>(SERVICE_TOKENS.taskQueue);
		const duplicateManager = this.container.resolve<DuplicateManager>(SERVICE_TOKENS.duplicateManager);
		const i18n = this.container.resolve<I18n>(SERVICE_TOKENS.i18n);

		logger.debug('CognitiveRazorPlugin', '开始订阅事件');

		// 1. 队列事件（Svelte 响应式 store 自动订阅，此处仅保留日志）
		const unsubQueue = taskQueue.subscribe((event) => {
			const status = taskQueue.getStatus();
			logger.debug('CognitiveRazorPlugin', '队列事件', { event, status });
		});
		this.unsubscribers.push(unsubQueue);

		// 2. 设置变更事件
		const unsubSettings = this.settingsStore.subscribe((newSettings) => {
			this.settings = newSettings;

			logger.debug('CognitiveRazorPlugin', '设置已更新', {
				logLevel: newSettings.logLevel,
				concurrency: newSettings.concurrency,
				providersCount: Object.keys(newSettings.providers).length
			});
		});
		this.unsubscribers.push(unsubSettings);

		// 3. 重复对变更事件（Svelte 响应式 store 自动订阅，此处仅保留日志）
		const unsubDuplicates = duplicateManager.subscribe((pairs) => {
			logger.debug('CognitiveRazorPlugin', '重复对变更', { count: pairs.length });
		});
		this.unsubscribers.push(unsubDuplicates);

		logger.info('CognitiveRazorPlugin', '事件订阅完成');
	}

	/**
	 * 处理网络状态变更
	 */
	private handleNetworkStatusChange(online: boolean, reason?: string): void {
		const i18n = this.tryResolve<I18n>(SERVICE_TOKENS.i18n);
		const t = i18n?.t();

		if (online) {
			if (this.isOffline) {
				this.isOffline = false;
				if (t) new Notice(t.notices.networkRestored);
			}
			return;
		}

		if (!this.isOffline) {
			this.isOffline = true;
			const taskQueue = this.tryResolve<TaskQueue>(SERVICE_TOKENS.taskQueue);
			if (taskQueue) void taskQueue.pause();
			if (t) {
				new Notice(reason ? `${t.notices.networkOffline}: ${reason}` : t.notices.networkOffline);
			}
		}
	}

	/**
	 * 清理已删除笔记关联的数据
	 */
	private async cleanupAfterNoteDeleted(cruid: string, path: string): Promise<void> {
		const logger = this.tryResolve<Logger>(SERVICE_TOKENS.logger);
		const vectorIndex = this.tryResolve<VectorIndex>(SERVICE_TOKENS.vectorIndex);
		const duplicateManager = this.tryResolve<DuplicateManager>(SERVICE_TOKENS.duplicateManager);

		try {
			if (vectorIndex) {
				const result = await vectorIndex.delete(cruid);
				if (!result.ok && result.error.code !== 'E311_NOT_FOUND') {
					logger?.warn('CognitiveRazorPlugin', '删除笔记后清理向量索引失败', {
						cruid, path, error: result.error
					});
				}
			}

			if (duplicateManager) {
				const result = await duplicateManager.removePairsByNodeId(cruid);
				if (!result.ok) {
					logger?.warn('CognitiveRazorPlugin', '删除笔记后清理重复对失败', {
						cruid, path, error: result.error
					});
				}
			}
		} catch (error) {
			logger?.error('CognitiveRazorPlugin', '删除笔记后清理关联数据异常', error as Error, {
				cruid, path
			});
		}
	}

	// ========================================================================
	// 公开 API（向后兼容，供 UI 组件访问）
	// ========================================================================

	/**
	 * 获取 i18n 实例
	 */
	public getI18n(): I18n {
		return this.container.resolve<I18n>(SERVICE_TOKENS.i18n);
	}

	/**
	 * 检查插件是否已完全初始化（所有服务已注册）
	 * UI 组件应在调用 getComponents() 前检查此状态
	 */
	public isFullyInitialized(): boolean {
		return this.container?.has(SERVICE_TOKENS.createOrchestrator) ?? false;
	}

	/**
	 * 检查 Data 层是否已初始化（最小可用状态）
	 */
	public isDataLayerReady(): boolean {
		return this.container?.has(SERVICE_TOKENS.settingsStore) ?? false;
	}

	/**
	 * 获取组件（供其他模块使用）
	 * 所有服务通过 ServiceContainer 解析，UI 组件不直接依赖 Plugin 实例获取服务
	 *
	 * @see 需求 1.4, 1.5
	 * @throws 如果服务尚未初始化完成，抛出友好错误提示
	 */
	public getComponents() {
		// 防御性检查：确保 Core 层已初始化
		if (!this.isFullyInitialized()) {
			throw new Error('插件尚未完全初始化，请稍后重试');
		}

		return {
			container: this.container,
			settings: this.settings,
			settingsStore: this.container.resolve<SettingsStore>(SERVICE_TOKENS.settingsStore),
			i18n: this.container.resolve<I18n>(SERVICE_TOKENS.i18n),

			fileStorage: this.container.resolve<FileStorage>(SERVICE_TOKENS.fileStorage),
			logger: this.container.resolve<Logger>(SERVICE_TOKENS.logger),
			validator: this.container.resolve<Validator>(SERVICE_TOKENS.validator),

			cruidCache: this.container.resolve<CruidCache>(SERVICE_TOKENS.cruidCache),
			vectorIndex: this.container.resolve<VectorIndex>(SERVICE_TOKENS.vectorIndex),
			lockManager: this.container.resolve<SimpleLockManager>(SERVICE_TOKENS.lockManager),
			providerManager: this.container.resolve<ProviderManager>(SERVICE_TOKENS.providerManager),
			promptManager: this.container.resolve<PromptManager>(SERVICE_TOKENS.promptManager),
			duplicateManager: this.container.resolve<DuplicateManager>(SERVICE_TOKENS.duplicateManager),
			taskQueue: this.container.resolve<TaskQueue>(SERVICE_TOKENS.taskQueue),
			taskRunner: this.container.resolve<TaskRunner>(SERVICE_TOKENS.taskRunner),
			createOrchestrator: this.container.resolve<CreateOrchestrator>(SERVICE_TOKENS.createOrchestrator),
			verifyOrchestrator: this.container.resolve<VerifyOrchestrator>(SERVICE_TOKENS.verifyOrchestrator),
			expandOrchestrator: this.container.resolve<ExpandOrchestrator>(SERVICE_TOKENS.expandOrchestrator),
		};
	}
}
