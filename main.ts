/** Cognitive Razor - 公理化知识管理插件主入口 */

import { Plugin, Notice } from 'obsidian';
import { PluginSettings } from './src/types';

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
import { UndoManager } from './src/core/undo-manager';
import { ProviderManager } from './src/core/provider-manager';
import { PromptManager } from './src/core/prompt-manager';
import { DuplicateManager } from './src/core/duplicate-manager';
import { TaskQueue } from './src/core/task-queue';
import { TaskRunner } from './src/core/task-runner';

import { PipelineOrchestrator } from './src/core/pipeline-orchestrator';
import { DeepenOrchestrator } from './src/core/deepen-orchestrator';
import { ImageInsertOrchestrator } from './src/core/image-insert-orchestrator';

// UI 层组件
import { WorkbenchPanel, WORKBENCH_VIEW_TYPE } from './src/ui/workbench-panel';
import { StatusBadge } from './src/ui/status-badge';
import { CommandDispatcher } from './src/ui/command-dispatcher';
import { CognitiveRazorSettingTab } from './src/ui/settings-tab';
import { SetupWizard } from './src/ui/setup-wizard';

/** Cognitive Razor 插件主类 */
export default class CognitiveRazorPlugin extends Plugin {
	// 设置
	settings!: PluginSettings;
	settingsStore!: SettingsStore;

	// 国际化
	private i18n!: I18n;

	// 数据层组件
	private fileStorage!: FileStorage;
	private logger!: Logger;
	private validator!: Validator;

	// 应用层组件
	private cruidCache!: CruidCache;
	private vectorIndex!: VectorIndex;
	private lockManager!: SimpleLockManager;
	private undoManager!: UndoManager;
	private providerManager!: ProviderManager;
	private promptManager!: PromptManager;
	private duplicateManager!: DuplicateManager;
	private taskQueue!: TaskQueue;
	private taskRunner!: TaskRunner;
	private pipelineOrchestrator!: PipelineOrchestrator;
	private deepenOrchestrator!: DeepenOrchestrator;
	private imageInsertOrchestrator!: ImageInsertOrchestrator;

	// UI 组件
	private statusBadge!: StatusBadge;
	private commandDispatcher!: CommandDispatcher;
	private unsubscribers: Array<() => void> = [];

	// 数据目录路径
	private dataDir!: string;
	private isOffline = false;

	/** 插件加载 */
	async onload() {
		try {
			// 1. 初始化数据目录
			await this.initializeDataDirectory();

			// 2. 初始化数据层组件
			await this.initializeDataLayer();

			// Requirements 8.5: 输出初始化日志确认日志系统正常工作
			this.logger.info('CognitiveRazorPlugin', 'Cognitive Razor 插件初始化开始', {
				event: 'PLUGIN_INIT',
				version: this.manifest.version,
				minAppVersion: this.manifest.minAppVersion
			});

			// 3. 加载设置
			await this.loadSettings();

			// 4. 初始化国际化
			this.i18n = new I18n(this.settings.language);
			this.logger.debug('CognitiveRazorPlugin', 'i18n 初始化完成', {
				language: this.settings.language
			});

			// 5. 检查是否需要首次配置向导
			const needsSetup = await this.checkNeedsSetup();
			if (needsSetup) {
				// 延迟显示配置向导，等待 workspace 准备就绪
				this.app.workspace.onLayoutReady(() => {
					this.showSetupWizard();
				});
			}

			// 6. 初始化应用层组件
			await this.initializeApplicationLayer();

			// 7. 注册视图
			this.registerViews();

			// 8. 初始化 UI 组件
			this.initializeUIComponents();

			// 9. 注册命令
			this.registerCommands();

			// 10. 添加设置面板
			this.addSettingTab(new CognitiveRazorSettingTab(this.app, this));

			// 11. 订阅事件，更新 UI
			this.subscribeToEvents();

			// Requirements 8.5: 输出初始化完成日志确认日志系统正常工作
			this.logger.info('CognitiveRazorPlugin', 'Cognitive Razor 插件初始化完成', {
				event: 'PLUGIN_INIT_COMPLETE',
				version: this.manifest.version,
				logLevel: this.settings.logLevel
			});
		} catch (error) {
			console.error('Cognitive Razor 插件加载失败:', error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`插件加载失败: ${errorMessage}`);
			
			// 记录错误日志
			if (this.logger) {
				this.logger.error('CognitiveRazorPlugin', '插件加载失败', error as Error, {
					event: 'PLUGIN_INIT_ERROR'
				});
			}
		}
	}

	/**
	 * 外部设置变更回调 (Obsidian 1.5.7+)
	 * 当 data.json 被外部修改时触发（如 Obsidian Sync）
	 */
	async onExternalSettingsChange(): Promise<void> {
		this.logger?.info('CognitiveRazorPlugin', '检测到外部设置变更，重新加载设置');
		
		try {
			const loadResult = await this.settingsStore.loadSettings();
			if (loadResult.ok) {
				this.settings = this.settingsStore.getSettings();
				this.logger?.debug('CognitiveRazorPlugin', '外部设置变更已加载');
			}
		} catch (error) {
			this.logger?.error('CognitiveRazorPlugin', '重新加载设置失败', error as Error);
		}
	}

	/**
	 * 插件卸载
	 * 
	 * 清理顺序：
	 * 1. 暂停任务队列
	 * 2. 停止增量改进处理器
	 * 3. 保存设置
	 * 4. 清理 UI 组件
	 * 5. 卸载视图
	 */
	async onunload() {
		this.logger?.info('CognitiveRazorPlugin', '开始卸载插件');

		try {
			// 1. 暂停任务队列
			if (this.taskQueue) {
				await this.taskQueue.pause();
				this.taskQueue.stop();
				this.logger?.debug('CognitiveRazorPlugin', '任务队列已暂停并停止调度器');
			}

			// 2. 停止管线编排器和索引自愈
			this.pipelineOrchestrator?.dispose();
			this.cruidCache?.dispose();

			// 3. 保存设置（SettingsStore 使用 Obsidian 的 saveData，在 updateSettings 时自动保存）
			this.logger?.debug('CognitiveRazorPlugin', '设置已通过 Obsidian 自动保存');

			// 4. 清理 UI 组件
			if (this.statusBadge) {
				this.statusBadge.destroy();
				this.logger?.debug('CognitiveRazorPlugin', '状态栏徽章已清理');
			}

			// 5. 卸载视图
			this.app.workspace.detachLeavesOfType(WORKBENCH_VIEW_TYPE);
			this.logger?.debug('CognitiveRazorPlugin', '视图已卸载');

			// 6. 解除所有订阅
			for (const unsub of this.unsubscribers) {
				try {
					unsub();
				} catch (e) {
					this.logger?.warn('CognitiveRazorPlugin', '取消订阅时出错', { error: e });
				}
			}
			this.unsubscribers = [];

			this.logger?.info('CognitiveRazorPlugin', '插件卸载完成');
		} catch (error) {
			console.error('Cognitive Razor 插件卸载失败:', error);
			
			if (this.logger) {
				this.logger.error('CognitiveRazorPlugin', '插件卸载失败', error as Error);
			}
		}
	}

	/**
	 * 初始化数据目录
	 * 
	 * 遵循设计文档 A-FUNC-07 本地优先存储：
	 * - data.json           插件配置（由 Obsidian loadData/saveData 管理）
	 * - data/               运行时数据根目录
	 *   - queue-state.json  队列状态
	 *   - app.log           循环日志（1MB）
	 *   - vector-index.json 向量索引
	 *   - duplicate-pairs.json 重复对列表
	 *   - snapshots/        快照目录（因文件数量多而使用子目录）
	 *     - index.json      快照索引
	 *     - *.json          快照文件
	 */
	private async initializeDataDirectory(): Promise<void> {
		// 数据目录路径
		this.dataDir = `${this.manifest.dir}/data`;

		// 确保数据目录及子目录存在
		// 遵循设计文档：单文件直接放在 data/ 下，快照和向量使用子目录
		const adapter = this.app.vault.adapter;
		const directories = [
			this.dataDir,
			`${this.dataDir}/snapshots`,
			`${this.dataDir}/vectors`,
			`${this.dataDir}/vectors/Domain`,
			`${this.dataDir}/vectors/Issue`,
			`${this.dataDir}/vectors/Theory`,
			`${this.dataDir}/vectors/Entity`,
			`${this.dataDir}/vectors/Mechanism`
		];

		for (const dir of directories) {
			const exists = await adapter.exists(dir);
			if (!exists) {
				await adapter.mkdir(dir);
			}
		}
	}

	/**
	 * 初始化数据层组件
	 * 
	 * 遵循设计文档 A-FUNC-07 存储结构：
	 * - 日志文件：data/app.log（循环日志 1MB）
	 * 
	 * 初始化顺序：
	 * 1. FileStorage - 文件存储（依赖：Obsidian Vault）
	 * 2. Logger - 日志记录器（依赖：FileStorage）
	 * 3. SettingsStore - 设置存储（依赖：Plugin）
	 * 4. Validator - 验证器（依赖：VectorIndex，稍后注入）
	 */
	private async initializeDataLayer(): Promise<void> {
		// 1. FileStorage（使用 Obsidian Vault）
		// 使用 app.vault.configDir 获取 .obsidian 目录的相对路径
		// 然后拼接插件 ID 得到插件目录的相对路径
		const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		this.fileStorage = new FileStorage(this.app.vault, pluginDir);
		
		// 初始化文件存储（创建目录结构和初始化数据文件）
		const initResult = await this.fileStorage.initialize();
		if (!initResult.ok) {
			throw new Error(`FileStorage 初始化失败: ${initResult.error.message}`);
		}

		// 2. Logger（遵循设计文档 A-NF-03：日志级别从设置读取）
		// 日志文件路径遵循 A-FUNC-07：data/app.log
		// 注意：传入相对路径，FileStorage 会自动添加 basePath
		const logFilePath = 'data/app.log';
		// 初始化时使用默认日志级别，加载设置后会更新
		const initialLogLevel = this.settings?.logLevel || DEFAULT_SETTINGS.logLevel;
		this.logger = new Logger(
			logFilePath,
			{
				write: async (path: string, content: string) => {
					const result = await this.fileStorage.write(path, content);
					if (!result.ok) {
						throw new Error(`写入日志文件失败: ${result.error.message}`);
					}
				},
				read: async (path: string) => {
					const result = await this.fileStorage.read(path);
					if (!result.ok) {
						// 文件不存在时返回空字符串，而不是抛出异常
						if (result.error.code === 'E300') {
							return '';
						}
						throw new Error(`读取日志文件失败: ${result.error.message}`);
					}
					return result.value;
				},
				exists: async (path: string) => {
					return await this.fileStorage.exists(path);
				}
			},
			initialLogLevel // 使用默认日志级别，加载设置后会更新
		);

		// 初始化 Logger（读取既有日志文件）
		await this.logger.initialize();

		this.logger.info('CognitiveRazorPlugin', '数据层组件初始化开始');

		// 3. SettingsStore（在 loadSettings 中初始化）
		// 4. Validator（在 initializeApplicationLayer 中初始化，需要 VectorIndex）

		this.logger.info('CognitiveRazorPlugin', '数据层组件初始化完成');
	}

	/**
	 * 加载设置
	 * 
	 * 步骤：
	 * 1. 创建 VersionChecker
	 * 2. 创建 SettingsStore
	 * 3. 加载设置（从 data.json）
	 * 4. 检查版本兼容性（TA-07）
	 * 5. 同步日志级别
	 */
	private async loadSettings(): Promise<void> {
		this.logger.info('CognitiveRazorPlugin', '开始加载设置');

		// 创建 SettingsStore（使用 Obsidian 标准 data.json）
		this.settingsStore = new SettingsStore(this);

		// 加载设置（版本检查已在 SettingsStore 内部处理）
		const loadResult = await this.settingsStore.loadSettings();
		if (!loadResult.ok) {
			this.logger.error('CognitiveRazorPlugin', '加载设置失败', undefined, { 
				error: loadResult.error 
			});
			// 使用默认设置
			this.settings = { ...DEFAULT_SETTINGS };
			this.logger.warn('CognitiveRazorPlugin', '使用默认设置');
		} else {
			this.settings = this.settingsStore.getSettings();
			
			this.logger.info('CognitiveRazorPlugin', '设置加载成功', {
				version: this.settings.version,
				language: this.settings.language,
				providersCount: Object.keys(this.settings.providers).length
			});
		}

		// 5. 同步日志级别到 Logger
		if (this.logger && this.settings.logLevel) {
			this.logger.setLogLevel(this.settings.logLevel);
			this.logger.debug('CognitiveRazorPlugin', '日志配置已同步', {
				logLevel: this.settings.logLevel
			});
		}
	}

	/**
	 * 检查是否需要首次配置
	 */
	private async checkNeedsSetup(): Promise<boolean> {
		// 如果没有配置任何 Provider，需要首次配置
		const providers = Object.keys(this.settings.providers);
		return providers.length === 0;
	}

	/**
	 * 显示配置向导
	 */
	private showSetupWizard(): void {
		this.logger.info('CognitiveRazorPlugin', '显示首次配置向导');
		
		// 打开配置向导模态框
		const wizard = new SetupWizard(this.app, this);
		wizard.open();
	}

	/**
	 * 初始化应用层组件
	 * 
	 * 遵循设计文档 A-FUNC-07 存储结构：
	 * - data/vector-index.json   向量索引
	 * - data/queue-state.json    队列状态
	 * - data/duplicate-pairs.json 重复对列表
	 * - data/snapshots/          快照目录
	 * 
	 * 初始化顺序（按依赖关系）：
	 * 1. VectorIndex - 向量索引（依赖：FileStorage）
	 * 2. Validator - 验证器（依赖：VectorIndex）
	 * 3. LockManager - 锁管理器（无依赖）
	 * 4. UndoManager - 撤销管理器（依赖：FileStorage）
	 * 5. ProviderManager - Provider 管理器（依赖：Settings）
	 * 6. PromptManager - 提示词管理器（无依赖）
	 * 7. DuplicateManager - 重复管理器（依赖：FileStorage）
	 * 8. TaskRunner - 任务执行器（依赖：ProviderManager, PromptManager, Validator, UndoManager, Logger）
	 * 9. TaskQueue - 任务队列（依赖：FileStorage, LockManager, TaskRunner）
	 */
	private async initializeApplicationLayer(): Promise<void> {
		this.logger.info('CognitiveRazorPlugin', '应用层组件初始化开始');

		// 0. CruidCache（SSOT：cruid → TFile）
		this.cruidCache = new CruidCache(this.app, this.logger);
		this.cruidCache.start({ fallbackToRead: false });
		this.logger.debug('CognitiveRazorPlugin', 'CruidCache 已启动');

		// 1. VectorIndex (新架构：data/vectors/)
		// 从设置中读取嵌入维度（支持用户自定义）
		const embeddingDimension = this.settings.embeddingDimension || 1536;
		this.vectorIndex = new VectorIndex(
			this.fileStorage,
			'text-embedding-3-small',
			embeddingDimension,
			this.logger,
			this.cruidCache
		);
		const loadResult = await this.vectorIndex.load();
		if (!loadResult.ok) {
			this.logger.error('CognitiveRazorPlugin', 'VectorIndex 加载失败', undefined, {
				error: loadResult.error
			});
		}
		this.logger.debug('CognitiveRazorPlugin', 'VectorIndex 初始化完成', {
			stats: this.vectorIndex.getStats()
		});

		// 2. Validator
		this.validator = new Validator();
		this.logger.debug('CognitiveRazorPlugin', 'Validator 初始化完成');

		// 3. SimpleLockManager
		this.lockManager = new SimpleLockManager();
		this.logger.debug('CognitiveRazorPlugin', 'LockManager 初始化完成');

		// 4. UndoManager (A-FUNC-07: data/snapshots/, A-FUNC-02: 可配置保留策略)
		this.undoManager = new UndoManager(
			this.fileStorage,
			this.logger,
			'data/snapshots',
			this.settings.maxSnapshots,
			this.settings.maxSnapshotAgeDays ?? 30
		);
		const undoInitResult = await this.undoManager.initialize();
		if (!undoInitResult.ok) {
			this.logger.error('CognitiveRazorPlugin', 'UndoManager 初始化失败', undefined, {
				error: undoInitResult.error
			});
		}
		this.logger.debug('CognitiveRazorPlugin', 'UndoManager 初始化完成');

		// 清理过期快照（A-FUNC-02: 读取用户配置的保留天数）
		const maxAgeDays = this.settings.maxSnapshotAgeDays ?? 30;
		const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
		const cleanupResult = await this.undoManager.cleanupExpiredSnapshots(maxAgeMs);
		if (cleanupResult.ok && cleanupResult.value > 0) {
			this.logger.info('CognitiveRazorPlugin', `清理了 ${cleanupResult.value} 个过期快照`, {
				maxAgeDays,
				cleanedCount: cleanupResult.value
			});
		}

		// 5. ProviderManager
		this.providerManager = new ProviderManager(
			this.settingsStore,
			this.logger
		);
		const unsubNetwork = this.providerManager.subscribeNetworkStatus((online, error) => {
			this.handleNetworkStatusChange(online, error?.error?.message);
		});
		this.unsubscribers.push(unsubNetwork);
		this.logger.debug('CognitiveRazorPlugin', 'ProviderManager 初始化完成', {
			providersCount: this.providerManager.getConfiguredProviders().length
		});

		// 6. PromptManager
		// prompts 目录在插件目录下，使用相对路径（FileStorage 会自动添加 basePath）
		const promptsDir = 'prompts';
		this.promptManager = new PromptManager(
			this.fileStorage,
			this.logger,
			promptsDir
		);
		// 加载基础组件
		const baseComponentsResult = await this.promptManager.preloadAllBaseComponents();
		if (!baseComponentsResult.ok) {
			this.logger.warn('CognitiveRazorPlugin', '基础组件加载失败（非致命错误）', {
				error: baseComponentsResult.error
			});
		}
		// 加载提示词模板
		const preloadResult = await this.promptManager.preloadAllTemplates();
		if (!preloadResult.ok) {
			this.logger.error('CognitiveRazorPlugin', 'PromptManager 模板加载失败', undefined, {
				error: preloadResult.error,
				promptsDir
			});
			// 不中断初始化，但记录错误
		}
		this.logger.debug('CognitiveRazorPlugin', 'PromptManager 初始化完成');

		// 7. DuplicateManager (A-FUNC-07: data/duplicate-pairs.json)
		this.duplicateManager = new DuplicateManager(
			this.vectorIndex,
			this.fileStorage,
			this.logger,
			this.settingsStore,
			this.lockManager,
			'data/duplicate-pairs.json'
		);
		const dupInitResult = await this.duplicateManager.initialize();
		if (!dupInitResult.ok) {
			this.logger.error('CognitiveRazorPlugin', 'DuplicateManager 初始化失败', undefined, {
				error: dupInitResult.error
			});
		}
		this.logger.debug('CognitiveRazorPlugin', 'DuplicateManager 初始化完成', {
			pendingPairs: this.duplicateManager.getPendingPairs().length
		});

		// 订阅删除事件：清理向量索引与重复对（替代 IndexHealer 的 delete 逻辑）
		this.cruidCache.onDelete(({ cruid, path }) => {
			void this.cleanupAfterNoteDeleted(cruid, path);
		});

		// 8. TaskRunner（依赖注入所有必要组件）
		this.taskRunner = new TaskRunner({
			providerManager: this.providerManager,
			promptManager: this.promptManager,
			validator: this.validator,
			undoManager: this.undoManager,
			logger: this.logger,
			vectorIndex: this.vectorIndex,
			fileStorage: this.fileStorage,
			settingsStore: this.settingsStore,
			app: this.app
		});
		this.logger.debug('CognitiveRazorPlugin', 'TaskRunner 初始化完成');

		// 9. TaskQueue (A-FUNC-07: data/queue-state.json)
		this.taskQueue = new TaskQueue(
			this.lockManager,
			this.fileStorage,
			this.logger,
			this.settingsStore,
			'data/queue-state.json'
		);
		const queueInitResult = await this.taskQueue.initialize();
		if (!queueInitResult.ok) {
			this.logger.error('CognitiveRazorPlugin', 'TaskQueue 初始化失败', undefined, {
				error: queueInitResult.error
			});
		}
		
		// 注入 TaskRunner 到 TaskQueue（解决循环依赖）
		this.taskQueue.setTaskRunner(this.taskRunner);
		
		this.logger.debug('CognitiveRazorPlugin', 'TaskQueue 初始化完成', {
			status: this.taskQueue.getStatus()
		});

		// 10. PipelineOrchestrator（任务管线编排器，遵循 A-FUNC-05, A-FUNC-03）
		this.pipelineOrchestrator = new PipelineOrchestrator({
			app: this.app,
			taskQueue: this.taskQueue,
			taskRunner: this.taskRunner,
			duplicateManager: this.duplicateManager,
			logger: this.logger,
			fileStorage: this.fileStorage,
			vectorIndex: this.vectorIndex,
			undoManager: this.undoManager,
			promptManager: this.promptManager,  // A-FUNC-03: 用于模板前置校验
			providerManager: this.providerManager,  // A-FUNC-03: 用于 Provider 前置校验
			cruidCache: this.cruidCache,
			getSettings: () => this.settings,
		});
		this.logger.debug('CognitiveRazorPlugin', 'PipelineOrchestrator 初始化完成');

		// DeepenOrchestrator（深化编排器）
		this.deepenOrchestrator = new DeepenOrchestrator({
			app: this.app,
			logger: this.logger,
			vectorIndex: this.vectorIndex,
			fileStorage: this.fileStorage,
			pipelineOrchestrator: this.pipelineOrchestrator,
			getSettings: () => this.settings
		});
		this.logger.debug('CognitiveRazorPlugin', 'DeepenOrchestrator 初始化完成');

		// ImageInsertOrchestrator（图片插入编排器）
		this.imageInsertOrchestrator = new ImageInsertOrchestrator(
			this.taskQueue,
			this.settingsStore,
			this.logger
		);
		this.logger.debug('CognitiveRazorPlugin', 'ImageInsertOrchestrator 初始化完成');

		this.logger.info('CognitiveRazorPlugin', '应用层组件初始化完成');
	}



	/**
	 * 注册视图
	 * 
	 * 重构说明：仅注册统一工作台视图
	 * - WorkbenchPanel：集成所有功能的统一操作枢纽
	 * - 已废除独立的 QueueView 和 UndoHistoryView
	 */
	private registerViews(): void {
		this.logger.debug('CognitiveRazorPlugin', '开始注册视图');

		// 注册工作台视图（统一操作枢纽）
		this.registerView(
			WORKBENCH_VIEW_TYPE,
			(leaf) => {
				const panel = new WorkbenchPanel(leaf);
				panel.setPlugin(this);
				this.logger.debug('CognitiveRazorPlugin', 'WorkbenchPanel 视图已创建');
				return panel;
			}
		);

		this.logger.info('CognitiveRazorPlugin', '视图注册完成', {
			views: [WORKBENCH_VIEW_TYPE]
		});
	}

	/**
	 * 初始化 UI 组件
	 * 
	 * 初始化的组件：
	 * 1. StatusBadge - 状态栏徽章（显示队列状态）
	 */
	private initializeUIComponents(): void {
		this.logger.debug('CognitiveRazorPlugin', '开始初始化 UI 组件');

		// StatusBadge
		this.statusBadge = new StatusBadge(this);
		
		// 初始化状态
		const status = this.taskQueue.getStatus();
		this.statusBadge.updateStatus(status);
		this.logger.debug('CognitiveRazorPlugin', 'StatusBadge 初始化完成', {
			status
		});

		this.logger.info('CognitiveRazorPlugin', 'UI 组件初始化完成');
	}

	/**
	 * 注册命令
	 * 
	 * 通过 CommandDispatcher 注册所有命令：
	 * - cognitive-razor:create-concept - 创建概念
	 * - cognitive-razor:open-queue - 打开队列视图
	 * - cognitive-razor:open-workbench - 打开工作台面板
	 * - cognitive-razor:pause-queue - 暂停队列
	 * - cognitive-razor:resume-queue - 恢复队列
	 * - 等等...
	 */
	private registerCommands(): void {
		this.logger.debug('CognitiveRazorPlugin', '开始注册命令');

		// CommandDispatcher
		this.commandDispatcher = new CommandDispatcher(this, this.taskQueue);
		this.commandDispatcher.registerAllCommands();

		this.logger.info('CognitiveRazorPlugin', '命令注册完成');
	}

	/**
	 * 订阅事件
	 * 
	 * 订阅的事件：
	 * 1. 队列事件 - 更新 UI（状态栏、工作台、队列视图）
	 * 2. 设置变更事件 - 同步配置（Provider、日志级别）
	 * 3. 重复对变更事件 - 更新工作台面板
	 */
	private subscribeToEvents(): void {
		this.logger.debug('CognitiveRazorPlugin', '开始订阅事件');

		// 1. 订阅队列事件
		const unsubQueue = this.taskQueue.subscribe((event) => {
			// 更新状态栏
			const status = this.taskQueue.getStatus();
			this.statusBadge.updateStatus(status);

			// 更新工作台面板
			const workbenchLeaves = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
			if (workbenchLeaves.length > 0) {
				const workbench = workbenchLeaves[0].view as WorkbenchPanel;
				workbench.updateQueueStatus(status);
			}

			// 队列视图已废除，功能已整合到工作台

			// 记录事件
			this.logger.debug('CognitiveRazorPlugin', '队列事件', { 
				event,
				status
			});
		});
		this.unsubscribers.push(unsubQueue);

		// 2. 订阅设置变更事件
		const unsubSettings = this.settingsStore.subscribe((newSettings) => {
			this.settings = newSettings;
			
			// 同步语言设置到 i18n
			if (this.i18n && newSettings.language !== this.i18n.getLanguage()) {
				this.i18n.setLanguage(newSettings.language);
				this.logger.debug('CognitiveRazorPlugin', '语言已切换', {
					language: newSettings.language
				});
			}
			
			this.logger.debug('CognitiveRazorPlugin', '设置已更新', {
				logLevel: newSettings.logLevel,
				concurrency: newSettings.concurrency,
				providersCount: Object.keys(newSettings.providers).length
			});
		});
		this.unsubscribers.push(unsubSettings);

		// 3. 订阅重复对变更事件
		const unsubDuplicates = this.duplicateManager.subscribe((pairs) => {
			// 更新工作台面板
			const workbenchLeaves = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
			if (workbenchLeaves.length > 0) {
				const workbench = workbenchLeaves[0].view as WorkbenchPanel;
				workbench.updateDuplicates(pairs);
			}

			this.logger.debug('CognitiveRazorPlugin', '重复对变更', {
				count: pairs.length
			});
		});
		this.unsubscribers.push(unsubDuplicates);

		this.logger.info('CognitiveRazorPlugin', '事件订阅完成');
	}

	/**
	 * 处理网络状态变更：离线时暂停队列并更新状态栏，恢复时提示用户
	 */
	private handleNetworkStatusChange(online: boolean, reason?: string): void {
		const t = this.i18n.t();

		if (online) {
			if (this.isOffline) {
				this.isOffline = false;
				if (this.statusBadge) {
					this.statusBadge.setOffline(false);
				}
				new Notice(t.notices.networkRestored);
			}
			return;
		}

		if (!this.isOffline) {
			this.isOffline = true;
			if (this.taskQueue) {
				void this.taskQueue.pause();
			}
			if (this.statusBadge) {
				this.statusBadge.setOffline(true);
			}
			new Notice(reason ? `${t.notices.networkOffline}: ${reason}` : t.notices.networkOffline);
		}
	}

	/**
	 * 清理已删除笔记关联的数据（替代 IndexHealer）
	 */
	private async cleanupAfterNoteDeleted(cruid: string, path: string): Promise<void> {
		try {
			// 1) 向量索引清理
			if (this.vectorIndex) {
				const result = await this.vectorIndex.delete(cruid);
				if (!result.ok && result.error.code !== 'E004') {
					this.logger.warn('CognitiveRazorPlugin', '删除笔记后清理向量索引失败', {
						cruid,
						path,
						error: result.error
					});
				}
			}

			// 2) 重复对清理（仅清理 pending/dismissed）
			if (this.duplicateManager) {
				const result = await this.duplicateManager.removePairsByNodeId(cruid);
				if (!result.ok) {
					this.logger.warn('CognitiveRazorPlugin', '删除笔记后清理重复对失败', {
						cruid,
						path,
						error: result.error
					});
				}
			}
		} catch (error) {
			this.logger.error('CognitiveRazorPlugin', '删除笔记后清理关联数据异常', error as Error, {
				cruid,
				path
			});
		}
	}



	/**
	 * 获取 i18n 实例
	 */
	public getI18n(): I18n {
		return this.i18n;
	}

	/**
	 * 获取组件（供其他模块使用）
	 * 
	 * 提供依赖注入接口，允许 UI 层和其他模块访问应用层和数据层组件
	 * 
	 * @returns 所有核心组件的引用
	 */
	public getComponents() {
		return {
			// 设置
			settings: this.settings,
			settingsStore: this.settingsStore,
			i18n: this.i18n,
			
			// 数据层
			fileStorage: this.fileStorage,
			logger: this.logger,
			validator: this.validator,
			
			// 应用层
			cruidCache: this.cruidCache,
			vectorIndex: this.vectorIndex,
			lockManager: this.lockManager,
			undoManager: this.undoManager,
			providerManager: this.providerManager,
			promptManager: this.promptManager,
			duplicateManager: this.duplicateManager,
			taskQueue: this.taskQueue,
			taskRunner: this.taskRunner,
			pipelineOrchestrator: this.pipelineOrchestrator,
			deepenOrchestrator: this.deepenOrchestrator,
			imageInsertOrchestrator: this.imageInsertOrchestrator,
		};
	}
}
