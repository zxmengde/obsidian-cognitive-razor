/**
 * Cognitive Razor - 公理化知识管理插件
 * 主入口文件
 */

import { Plugin, Notice } from 'obsidian';
import { CognitiveRazorSettings } from './src/types';
import { SettingsStore, DEFAULT_SETTINGS } from './src/data/settings-store';
import { FileStorage } from './src/data/file-storage';
import { Logger } from './src/data/logger';
import { MigrationRunner } from './src/data/migration-runner';
import { VectorIndex } from './src/core/vector-index';
import { TaskQueue } from './src/core/task-queue';
import { LockManager } from './src/core/lock-manager';
import { DuplicateManager } from './src/core/duplicate-manager';
import { UndoManager } from './src/core/undo-manager';
import { ProviderManager } from './src/core/provider-manager';
import { PromptManager } from './src/core/prompt-manager';
import { IncrementalImproveHandler } from './src/core/incremental-improve-handler';
import { WorkbenchPanel, WORKBENCH_VIEW_TYPE } from './src/ui/workbench-panel';
import { QueueView, QUEUE_VIEW_TYPE } from './src/ui/queue-view';
import { StatusBadge } from './src/ui/status-badge';
import { CommandDispatcher } from './src/ui/command-dispatcher';
import { CognitiveRazorSettingTab } from './src/ui/settings-tab';
import { SetupWizard } from './src/ui/setup-wizard';

/**
 * Cognitive Razor 插件主类
 */
export default class CognitiveRazorPlugin extends Plugin {
	// 设置
	settings!: CognitiveRazorSettings;
	settingsStore!: SettingsStore;

	// 数据层组件
	private fileStorage!: FileStorage;
	private logger!: Logger;
	private migrationRunner!: MigrationRunner;

	// 核心组件
	private vectorIndex!: VectorIndex;
	private taskQueue!: TaskQueue;
	private lockManager!: LockManager;
	private duplicateManager!: DuplicateManager;
	private undoManager!: UndoManager;
	private providerManager!: ProviderManager;
	private promptManager!: PromptManager;
	private incrementalImproveHandler!: IncrementalImproveHandler;

	// UI 组件
	private statusBadge!: StatusBadge;
	private commandDispatcher!: CommandDispatcher;

	// 数据目录路径
	private dataDir!: string;

	/**
	 * 插件加载
	 */
	async onload() {
		console.log('加载 Cognitive Razor 插件');

		try {
			// 1. 初始化数据目录
			await this.initializeDataDirectory();

			// 2. 初始化数据层组件
			await this.initializeDataLayer();

			// 3. 加载设置
			await this.loadSettings();

			// 4. 运行数据迁移
			await this.runMigrations();

			// 5. 检查是否需要首次配置向导
			const needsSetup = await this.checkNeedsSetup();
			if (needsSetup) {
				// 延迟显示配置向导，等待 workspace 准备就绪
				this.app.workspace.onLayoutReady(() => {
					this.showSetupWizard();
				});
			}

			// 6. 初始化核心组件
			await this.initializeCoreComponents();

			// 7. 注册视图
			this.registerViews();

			// 8. 初始化 UI 组件
			this.initializeUIComponents();

			// 9. 注册命令
			this.registerCommands();

			// 10. 添加设置面板
			this.addSettingTab(new CognitiveRazorSettingTab(this.app, this));

			// 11. 订阅队列事件，更新 UI
			this.subscribeToQueueEvents();

			console.log('Cognitive Razor 插件加载完成');
		} catch (error) {
			console.error('Cognitive Razor 插件加载失败:', error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`插件加载失败: ${errorMessage}`);
		}
	}

	/**
	 * 插件卸载
	 */
	async onunload() {
		console.log('卸载 Cognitive Razor 插件');

		try {
			// 1. 暂停任务队列
			if (this.taskQueue) {
				this.taskQueue.pause();
			}

			// 2. 保存设置
			if (this.settingsStore) {
				await this.settingsStore.save();
			}

			// 3. 清理 UI 组件
			if (this.statusBadge) {
				this.statusBadge.destroy();
			}

			// 4. 卸载视图
			this.app.workspace.detachLeavesOfType(WORKBENCH_VIEW_TYPE);
			this.app.workspace.detachLeavesOfType(QUEUE_VIEW_TYPE);

			console.log('Cognitive Razor 插件卸载完成');
		} catch (error) {
			console.error('Cognitive Razor 插件卸载失败:', error);
		}
	}

	/**
	 * 初始化数据目录
	 */
	private async initializeDataDirectory(): Promise<void> {
		// 数据目录路径
		this.dataDir = `${this.manifest.dir}/data`;

		// 确保数据目录存在
		const adapter = this.app.vault.adapter;
		const exists = await adapter.exists(this.dataDir);
		if (!exists) {
			await adapter.mkdir(this.dataDir);
		}
	}

	/**
	 * 初始化数据层组件
	 */
	private async initializeDataLayer(): Promise<void> {
		// FileStorage
		this.fileStorage = new FileStorage({
			dataDir: this.dataDir,
		});

		// Logger
		this.logger = new Logger({
			storage: this.fileStorage,
			logFilePath: 'logs/app.log',
			minLevel: 'info',
			maxSize: 1024 * 1024, // 1MB
		});

		// MigrationRunner 将在加载设置后初始化
	}

	/**
	 * 加载设置
	 */
	private async loadSettings(): Promise<void> {
		// 创建 SettingsStore
		this.settingsStore = new SettingsStore({
			storage: this.fileStorage,
			logger: this.logger,
			settingsFilePath: 'settings.json',
		});

		// 加载设置
		const loadResult = await this.settingsStore.load();
		if (!loadResult.ok) {
			this.logger.error('加载设置失败', { error: loadResult.error });
			// 使用默认设置
			this.settings = { ...DEFAULT_SETTINGS };
		} else {
			this.settings = loadResult.value;
		}

		// 初始化 MigrationRunner（需要 settingsStore）
		this.migrationRunner = new MigrationRunner({
			storage: this.fileStorage,
			logger: this.logger,
			settingsStore: this.settingsStore,
			historyFilePath: 'migrations/history.json',
			migrations: [], // 暂时没有迁移脚本
		});
	}

	/**
	 * 运行数据迁移
	 */
	private async runMigrations(): Promise<void> {
		const currentVersion = this.manifest.version;
		const migrateResult = await this.migrationRunner.migrate(currentVersion);
		
		if (!migrateResult.ok) {
			this.logger.error('数据迁移失败', { error: migrateResult.error });
			new Notice('数据迁移失败，请查看日志');
		} else {
			this.logger.info('数据迁移完成');
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
		this.logger.info('显示首次配置向导');
		
		// 打开配置向导模态框
		const wizard = new SetupWizard(this.app, this);
		wizard.open();
	}

	/**
	 * 初始化核心组件
	 */
	private async initializeCoreComponents(): Promise<void> {
		// LockManager
		this.lockManager = new LockManager();

		// VectorIndex
		this.vectorIndex = new VectorIndex(this.fileStorage);

		// TaskQueue
		this.taskQueue = new TaskQueue({
			storage: this.fileStorage,
			lockManager: this.lockManager,
			concurrency: this.settings.concurrency,
			queueFile: 'queue/tasks.json',
		});
		await this.taskQueue.initialize();

		// DuplicateManager
		this.duplicateManager = new DuplicateManager(this.fileStorage);

		// UndoManager
		this.undoManager = new UndoManager({
			storage: this.fileStorage,
			maxSnapshots: this.settings.maxSnapshots,
		});

		// ProviderManager
		this.providerManager = new ProviderManager(this.settings.providers);

		// PromptManager
		this.promptManager = new PromptManager({
			templatePath: 'prompts',
			sharedConstraints: {
				outputFormat: '输出必须是有效的 JSON 格式',
				safety: '不得生成有害、非法或不当内容',
				generalRules: '遵循用户指令，提供准确、有用的回复'
			}
		});

		// IncrementalImproveHandler
		this.incrementalImproveHandler = new IncrementalImproveHandler({
			app: this.app,
			taskQueue: this.taskQueue,
			undoManager: this.undoManager,
			storage: this.fileStorage,
		});
		this.incrementalImproveHandler.start();

		this.logger.info('核心组件初始化完成');
	}

	/**
	 * 注册视图
	 */
	private registerViews(): void {
		// 注册工作台视图
		this.registerView(
			WORKBENCH_VIEW_TYPE,
			(leaf) => new WorkbenchPanel(leaf)
		);

		// 注册队列视图
		this.registerView(
			QUEUE_VIEW_TYPE,
			(leaf) => new QueueView(leaf)
		);

		this.logger.info('视图注册完成');
	}

	/**
	 * 初始化 UI 组件
	 */
	private initializeUIComponents(): void {
		// StatusBadge
		this.statusBadge = new StatusBadge(this);
		
		// 初始化状态
		const status = this.taskQueue.getStatus();
		this.statusBadge.updateStatus(status);

		this.logger.info('UI 组件初始化完成');
	}

	/**
	 * 注册命令
	 */
	private registerCommands(): void {
		// CommandDispatcher
		this.commandDispatcher = new CommandDispatcher(this, this.taskQueue);
		this.commandDispatcher.registerAllCommands();

		this.logger.info('命令注册完成');
	}

	/**
	 * 订阅队列事件
	 */
	private subscribeToQueueEvents(): void {
		this.taskQueue.subscribe((event) => {
			// 更新状态栏
			const status = this.taskQueue.getStatus();
			this.statusBadge.updateStatus(status);

			// 更新工作台面板
			const workbenchLeaves = this.app.workspace.getLeavesOfType(WORKBENCH_VIEW_TYPE);
			if (workbenchLeaves.length > 0) {
				const workbench = workbenchLeaves[0].view as WorkbenchPanel;
				workbench.updateQueueStatus(status);
			}

			// 更新队列视图
			const queueLeaves = this.app.workspace.getLeavesOfType(QUEUE_VIEW_TYPE);
			if (queueLeaves.length > 0) {
				const queueView = queueLeaves[0].view as QueueView;
				queueView.refresh();
			}

			// 记录事件
			this.logger.debug('队列事件', { event });
		});
	}

	/**
	 * 获取组件（供其他模块使用）
	 */
	public getComponents() {
		return {
			settings: this.settings,
			settingsStore: this.settingsStore,
			fileStorage: this.fileStorage,
			logger: this.logger,
			vectorIndex: this.vectorIndex,
			taskQueue: this.taskQueue,
			lockManager: this.lockManager,
			duplicateManager: this.duplicateManager,
			undoManager: this.undoManager,
			providerManager: this.providerManager,
			promptManager: this.promptManager,
		};
	}
}
