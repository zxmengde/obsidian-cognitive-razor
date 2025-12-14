/**
 * 国际化（i18n）模块
 * 
 * 功能：
 * - 管理多语言文本
 * - 提供语言切换
 * - 支持动态插值
 */

type Language = "zh" | "en";

/**
 * 翻译文本类型
 */
interface Translations {
  // 通用
  common: {
    confirm: string;
    cancel: string;
    save: string;
    delete: string;
    edit: string;
    add: string;
    close: string;
    loading: string;
    success: string;
    error: string;
    warning: string;
  };

  // 工作台
  workbench: {
    title: string;
    buttons: {
      improveNote: string;
      deepen: string;
      insertImage: string;
    };
    createConcept: {
      title: string;
      placeholder: string;
      startButton: string;
      defining: string;
      selectType: string;
      create: string;
    };
    duplicates: {
      title: string;
      sortBy: string;
      sortSimilarityDesc: string;
      sortSimilarityAsc: string;
      sortTimeDesc: string;
      sortTimeAsc: string;
      sortByType: string;
      filterBy: string;
      filterAll: string;
      selectAll: string;
      batchMerge: string;
      batchDismiss: string;
      viewHistory: string;
      empty: string;
      merge: string;
      dismiss: string;
      selectPair: string;
    };
    queueStatus: {
      title: string;
      active: string;
      paused: string;
      pending: string;
      running: string;
      completed: string;
      failed: string;
      cancelled: string;
      clearCompleted: string;
      clearFailed: string;
      retryFailed: string;
      pauseQueue: string;
      resumeQueue: string;
      viewDetails: string;
      currentPipeline: string;
      noPipeline: string;
      queuePaused: string;
      queueRunning: string;
      queueResumed: string;
      cancel: string;
      retry: string;
      taskId: string;
      type: string;
      status: string;
      progress: string;
      actions: string;
      noTasks: string;
      noteName: string;
    };
    recentOps: {
      title: string;
      empty: string;
      undo: string;
      viewSnapshot: string;
      refresh: string;
      clearAll: string;
      clearAllConfirmTitle: string;
      clearAllConfirmMessage: string;
      moreSnapshots: string;
      timeJustNow: string;
      timeMinutesAgo: string;
      timeHoursAgo: string;
      timeDaysAgo: string;
    };
    pipeline: {
      id: string;
      type: string;
      stage: string;
      view: string;
      confirmCreate: string;
      previewWrite: string;
      groundingResult: string;
      chineseName: string;
      englishName: string;
      autoSelect: string;
      saveEdit: string;
      generatedContentPreview: string;
      progressTitle: string;
      progressHint: string;
      empty: string;
      kind: {
        create: string;
        incremental: string;
        merge: string;
      };
      stages: {
        idle: string;
        defining: string;
        tagging: string;
        indexing: string;
        review_draft: string;
        writing: string;
        verifying: string;
        review_changes: string;
        saving: string;
        checking_duplicates: string;
        completed: string;
        failed: string;
      };
      stageMessages: {
        default: string;
        idle: string;
        defining: string;
        tagging: string;
        indexing: string;
        review_draft: string;
        writing: string;
        verifying: string;
        review_changes: string;
        saving: string;
        checking_duplicates: string;
        completed: string;
        failed: string;
      };
    };
    typeConfidenceTable: {
      type: string;
      standardName: string;
      confidence: string;
      action: string;
    };
    duplicatePreview: {
      title: string;
      similarity: string;
      type: string;
      detectedAt: string;
    };
    duplicateHistory: {
      title: string;
    };
    notifications: {
      systemNotInitialized: string;
      enterDescription: string;
      standardizeFailed: string;
      standardizeComplete: string;
      pluginNotInitialized: string;
      openMarkdownFirst: string;
      createFailed: string;
      conceptCreated: string;
      selectDuplicates: string;
      batchMergeConfirm: string;
      batchMergeComplete: string;
      batchDismissConfirm: string;
      batchDismissComplete: string;
      fileNotFound: string;
      previewFailed: string;
      mergeTaskCreated: string;
      duplicateManagerNotInitialized: string;
      dismissFailed: string;
      dismissSuccess: string;
      orchestratorNotInitialized: string;
      queueResumed: string;
      queuePaused: string;
      taskCancelled: string;
      cancelFailed: string;
      retryComplete: string;
      clearComplete: string;
      undoFailed: string;
      undoSuccess: string;
      undoSuccessRestored: string;
      confirmCreateFailed: string;
      confirmCreateWaiting: string;
      standardizeUpdated: string;
      undoDismissSuccess: string;
      deletePairSuccess: string;
      writeFailed: string;
      writeSuccess: string;
      writePreviewFailed: string;
      mergeCancelled: string;
      mergeStarted: string;
      improveStarted: string;
      imageTaskCreated: string;
      imageGenerationFailed: string;
      featureDisabled: string;
    };
  };
  deepen: {
    titlePrefix: string;
    stats: {
      total: string;
      creatable: string;
      existing: string;
      invalid: string;
    };
    selectAll: string;
    deselectAll: string;
    confirm: string;
    empty: string;
    status: {
      existing: string;
      invalid: string;
    };
    looseStructureHint: string;
    abstractTitlePrefix: string;
    abstractInstruction: string;
    abstractConfirm: string;
    similarity: string;
    notInitialized: string;
    started: string;
    startedWithFailures: string;
  };

  // 设置面板
  settings: {
    title: string;
    tabs?: {
      general: string;
      providers: string;
      knowledge: string;
      system: string;
    };
    groups?: {
      interface: string;
      deduplication: string;
      performance: string;
      directory: string;
      typeDirectories: string;
      vectorEmbedding: string;
      taskModels: string;
      snapshots: string;
      logging: string;
      dataManagement: string;
    };
    language: {
      name: string;
      desc: string;
      zh: string;
      en: string;
    };
    similarityThreshold: {
      name: string;
      desc: string;
    };
    maxSnapshots: {
      name: string;
      desc: string;
    };
    maxSnapshotAgeDays: {
      name: string;
      desc: string;
    };
    concurrency: {
      name: string;
      desc: string;
    };
    provider: {
      title: string;
      addButton: string;
      addDesc: string;
      noProvider: string;
      addFirstProvider?: string;
      defaultProvider: string;
      defaultProviderDesc: string;
      testConnection: string;
      setDefault: string;
      status: string;
      enabled: string;
      disabled: string;
      model: string;
    };
    importExport: {
      title: string;
      export: string;
      exportDesc: string;
      import: string;
      importDesc: string;
      reset: string;
      resetDesc: string;
    };
    advanced: {
      title: string;
      namingTemplate: {
        name: string;
        desc: string;
      };
      directoryScheme: {
        title: string;
        desc: string;
      };
      taskModels: {
        title: string;
        desc: string;
        providerAndModel: string;
        useDefaultProvider: string;
        configureProviderFirst: string;
        modelName: string;
        modelNamePlaceholder: string;
        notSet: string;
        low: string;
        medium: string;
        high: string;
        advancedParams: string;
      };
      temperature: {
        name: string;
        desc: string;
      };
      topP: {
        name: string;
        desc: string;
      };
      reasoningEffort: {
        name: string;
        desc: string;
      };
      deduplication: {
        title: string;
        topK: string;
        topKDesc: string;
      };
      embedding: {
        title: string;
        dimension: string;
        dimensionDesc: string;
        dimensionWarning: string;
      };
      features: {
        title: string;
        enableGrounding: string;
        enableGroundingDesc: string;
      };
      queue: {
        title: string;
        autoRetry: string;
        autoRetryDesc: string;
        maxRetryAttempts: string;
        maxRetryAttemptsDesc: string;
        taskTimeout: string;
        taskTimeoutDesc: string;
        maxTaskHistory: string;
        maxTaskHistoryDesc: string;
        providerTimeout: string;
        providerTimeoutDesc: string;
      };
      logging: {
        title: string;
        logLevel: string;
        logLevelDesc: string;
        clearLogs: string;
        clearLogsDesc: string;
        levels: {
          debug: string;
          info: string;
          warn: string;
          error: string;
        };
      };
    };
  };

  // 通知消息
  notices: {
    providerAdded: string;
    providerUpdated: string;
    providerDeleted: string;
    providerSetDefault: string;
    connectionSuccess: string;
    connectionFailed: string;
    settingsExported: string;
    settingsImported: string;
    settingsReset: string;
    logsCleared: string;
    noLogsToClean: string;
    languageChanged: string;
    logLevelChanged: string;
    groundingEnabled: string;
    groundingDisabled: string;
    networkRestored: string;
    networkOffline: string;
  };
  setupWizard: {
    title: string;
  };
  modals: {
    addProvider: {
      title: string;
    };
    editProvider: {
      title: string;
    };
  };

  // 确认对话框
  confirmDialogs: {
    deleteProvider: {
      title: string;
      message: string;
    };
    resetSettings: {
      title: string;
      message: string;
    };
    deleteDuplicatePair: {
      title: string;
      message: string;
    };
  };

  // 任务类型
  taskTypes: {
    define: {
      name: string;
      desc: string;
    };
    tag: {
      name: string;
      desc: string;
    };
    index: {
      name: string;
      desc: string;
    };
    write: {
      name: string;
      desc: string;
    };
    verify: {
      name: string;
      desc: string;
    };
  };

  // 知识类型
  crTypes: {
    Domain: string;
    Issue: string;
    Theory: string;
    Entity: string;
    Mechanism: string;
  };

  // 知识类型目录描述
  crTypeDirectories: {
    Domain: string;
    Issue: string;
    Theory: string;
    Entity: string;
    Mechanism: string;
  };

  taskModels: {
    title: string;
    resetAll: string;
    resetAllConfirm: string;
    reset: string;
    resetConfirm: string;
    isDefault: string;
    isCustom: string;
    recommended: string;
    fields: {
      provider: string;
      providerDesc: string;
      useDefaultProvider: string;
      model: string;
      modelDesc: string;
      temperature: string;
      temperatureDesc: string;
      topP: string;
      topPDesc: string;
      reasoningEffort: string;
      reasoningEffortDesc: string;
      embeddingDimension: string;
      embeddingDimensionDesc: string;
    };
    tasks: {
      define: { name: string; desc: string };
      tag: { name: string; desc: string };
      write: { name: string; desc: string };
      index: { name: string; desc: string };
      verify: { name: string; desc: string };
    };
    reasoningEffortOptions: {
      notSet: string;
      low: string;
      medium: string;
      high: string;
    };
    validation: {
      temperature: string;
      topP: string;
    };
  };

  imageGeneration: {
    title: string;
    enabled: { name: string; desc: string };
    defaultSize: { name: string; desc: string; square: string; landscape: string; portrait: string };
    defaultQuality: { name: string; desc: string; standard: string; hd: string };
    defaultStyle: { name: string; desc: string; vivid: string; natural: string };
    defaultAspectRatio: { name: string; desc: string };
    defaultImageSize: { name: string; desc: string };
    contextWindowSize: { name: string; desc: string };
  };
}

/**
 * i18n 管理器
 */
export class I18n {
  private currentLanguage: Language;
  private translations: Record<Language, Translations>;

  constructor(initialLanguage: Language = "zh") {
    this.currentLanguage = initialLanguage;
    this.translations = {
      zh: this.getZhTranslations(),
      en: this.getEnTranslations(),
    };
  }

  /**
   * 获取当前语言
   */
  getLanguage(): Language {
    return this.currentLanguage;
  }

  /**
   * 设置语言
   */
  setLanguage(language: Language): void {
    this.currentLanguage = language;
  }

  /**
   * 获取翻译文本
   */
  t(): Translations {
    return this.translations[this.currentLanguage];
  }

  /**
   * 获取中文翻译
   */
  private getZhTranslations(): Translations {
    return {
      common: {
        confirm: "确认",
        cancel: "取消",
        save: "保存",
        delete: "删除",
        edit: "编辑",
        add: "添加",
        close: "关闭",
        loading: "加载中...",
        success: "成功",
        error: "错误",
        warning: "警告",
      },
      workbench: {
        title: "工作台",
      buttons: {
        improveNote: "改进当前笔记",
        deepen: "深化当前笔记",
        insertImage: "插入图片",
      },
        createConcept: {
          title: "创建概念",
          placeholder: "输入概念描述...",
          startButton: "开始",
          defining: "定义中...",
          selectType: "请选择概念类型",
          create: "创建",
        },
        duplicates: {
          title: "重复概念",
          sortBy: "排序:",
          sortSimilarityDesc: "相似度 (高到低)",
          sortSimilarityAsc: "相似度 (低到高)",
          sortTimeDesc: "时间 (新到旧)",
          sortTimeAsc: "时间 (旧到新)",
          sortByType: "按类型",
          filterBy: "类型:",
          filterAll: "全部",
          selectAll: "全选",
          batchMerge: "批量合并",
          batchDismiss: "批量忽略",
          viewHistory: "查看历史",
          empty: "暂无重复概念",
          merge: "合并",
          dismiss: "忽略",
          selectPair: "选择重复对",
        },
        queueStatus: {
          title: "队列状态",
          active: "运行中",
          paused: "已暂停",
          pending: "待处理",
          running: "执行中",
          completed: "已完成",
          failed: "失败",
          cancelled: "已取消",
          clearCompleted: "清除已完成",
          clearFailed: "清除失败",
          retryFailed: "重试失败",
          pauseQueue: "暂停队列",
          resumeQueue: "恢复队列",
          viewDetails: "查看详情",
          currentPipeline: "当前管线",
          noPipeline: "暂无活动管线",
          queuePaused: "队列已暂停",
          queueRunning: "队列运行中",
          queueResumed: "队列已恢复运行",
          cancel: "取消",
          retry: "重试",
          taskId: "任务 ID",
          type: "类型",
          status: "状态",
          progress: "进度",
          actions: "操作",
          noTasks: "队列中暂无任务",
          noteName: "笔记名",
        },
        recentOps: {
          title: "操作历史",
          empty: "暂无可撤销的操作",
          undo: "撤销",
          viewSnapshot: "查看快照",
          refresh: "刷新",
          clearAll: "清空全部",
          clearAllConfirmTitle: "确认清空",
          clearAllConfirmMessage: "确定要清空所有快照吗？此操作不可撤销。",
          moreSnapshots: "还有 {count} 个更早的快照",
          timeJustNow: "刚刚",
          timeMinutesAgo: "{minutes} 分钟前",
          timeHoursAgo: "{hours} 小时前",
          timeDaysAgo: "{days} 天前",
        },
        pipeline: {
          id: "ID",
          type: "类型",
          stage: "阶段",
          view: "查看",
          confirmCreate: "确认创建",
        previewWrite: "预览写入",
        groundingResult: "校验结果：",
        chineseName: "中文名称：",
        englishName: "英文名称：",
        autoSelect: "自动选择",
        saveEdit: "保存编辑",
        generatedContentPreview: "生成内容预览（写入前）",
        progressTitle: "AI 阶段进度",
        progressHint: "实时显示 LLM 调用阶段与写入状态",
        empty: "当前没有进行中的管线",
        kind: {
          create: "创建",
          incremental: "增量改进",
          merge: "合并",
        },
        stages: {
          idle: "空闲",
          defining: "定义中",
          tagging: "标记中",
          indexing: "索引中",
          review_draft: "确认草稿",
          writing: "撰写中",
          verifying: "校验中",
          review_changes: "确认修改",
          saving: "写入中",
          checking_duplicates: "查重中",
          completed: "已完成",
          failed: "失败",
        },
        stageMessages: {
          default: "AI 正在处理该步骤",
          idle: "等待新任务开始",
          defining: "分析输入并完成概念定义",
          tagging: "扩展别名、标签等上下文",
          indexing: "生成语义向量以便搜索",
          review_draft: "等待确认创建草稿",
          writing: "生成正文或合并内容",
          verifying: "AI 校验中，确保输出可靠",
          review_changes: "等待用户确认写入",
          saving: "写入文件并生成快照",
          checking_duplicates: "刷新查重索引，清理历史记录",
          completed: "流程已完成，可在历史中撤销",
          failed: "流程失败，请查看错误信息或重试",
        },
      },
        typeConfidenceTable: {
          type: "类型",
          standardName: "标准名称",
          confidence: "置信度",
          action: "操作",
        },
        duplicatePreview: {
          title: "重复概念预览",
          similarity: "相似度:",
          type: "类型:",
          detectedAt: "检测时间:",
        },
        duplicateHistory: {
          title: "重复对历史",
        },
        notifications: {
          systemNotInitialized: "系统未初始化",
          enterDescription: "请输入概念描述",
          standardizeFailed: "定义失败",
          standardizeComplete: "定义完成，请选择类型",
          pluginNotInitialized: "插件未初始化",
          openMarkdownFirst: "请先打开一个 Markdown 笔记",
          createFailed: "创建失败",
          conceptCreated: "概念创建已启动",
          selectDuplicates: "请先选择要合并的重复对",
          batchMergeConfirm: "确定要合并选中的重复对吗？",
          batchMergeComplete: "批量合并完成",
          batchDismissConfirm: "确定要忽略选中的重复对吗？",
          batchDismissComplete: "批量忽略完成",
          fileNotFound: "文件不存在",
          previewFailed: "显示预览失败",
          mergeTaskCreated: "合并任务已创建",
          duplicateManagerNotInitialized: "重复管理器未初始化",
          orchestratorNotInitialized: "管线编排器未初始化",
          dismissFailed: "忽略失败",
          dismissSuccess: "已忽略重复对",
          queueResumed: "队列已恢复运行",
          queuePaused: "队列已暂停",
          taskCancelled: "任务已取消",
          cancelFailed: "取消失败",
          retryComplete: "已重试失败任务",
          clearComplete: "已清除任务",
          undoFailed: "撤销失败",
          undoSuccess: "撤销成功",
          undoSuccessRestored: "撤销成功（文件已恢复）",
          confirmCreateFailed: "确认创建失败",
          confirmCreateWaiting: "已确认创建，等待内容生成",
          standardizeUpdated: "已更新定义结果",
          undoDismissSuccess: "已撤销忽略，重复对已恢复到待处理列表",
          deletePairSuccess: "已删除重复对记录",
          writeFailed: "写入失败",
          writeSuccess: "已写入，支持撤销",
          writePreviewFailed: "无法生成写入预览",
          mergeCancelled: "已取消合并",
          mergeStarted: "合并任务已启动，请等待 AI 生成合并内容...",
          improveStarted: "改进任务已启动，请等待 AI 生成改进内容...",
          imageTaskCreated: "图片生成任务已创建",
          imageGenerationFailed: "图片生成任务创建失败",
          featureDisabled: "功能已关闭",
        },
      },
      deepen: {
        titlePrefix: "深化：",
        stats: {
          total: "候选总数",
          creatable: "可创建",
          existing: "已存在",
          invalid: "不可创建",
        },
        selectAll: "全选",
        deselectAll: "全不选",
        confirm: "创建已选",
        empty: "暂无候选项",
        status: {
          existing: "已存在",
          invalid: "不可创建",
        },
        looseStructureHint: "未找到标准章节，已回退全局扫描，结果可能不完整",
        abstractTitlePrefix: "抽象：",
        abstractInstruction: "选择至少 1 个相似概念，与当前笔记一起生成更高层概念。",
        abstractConfirm: "生成",
        similarity: "相似度",
        notInitialized: "Deepen 功能未初始化",
        started: "已启动 {count} 个创建任务",
        startedWithFailures: "已启动 {started} 个任务，{failed} 个未能启动",
      },
      settings: {
        title: "Cognitive Razor 设置",
        tabs: {
          general: "通用",
          providers: "AI Providers",
          knowledge: "知识库",
          system: "系统"
        },
        groups: {
          interface: "界面",
          deduplication: "去重",
          performance: "性能",
          directory: "目录结构",
          typeDirectories: "类型目录",
          vectorEmbedding: "向量嵌入",
          taskModels: "任务模型配置",
          snapshots: "快照与撤销",
          logging: "日志",
          dataManagement: "数据管理"
        },
        language: {
          name: "语言",
          desc: "选择界面语言",
          zh: "中文",
          en: "English",
        },
        similarityThreshold: {
          name: "相似度阈值",
          desc: "用于检测重复概念的相似度阈值 (0-1)",
        },
        maxSnapshots: {
          name: "最大快照数量",
          desc: "用于撤销操作的最大快照数量",
        },
        maxSnapshotAgeDays: {
          name: "快照保留天数",
          desc: "超过此天数的快照将被自动清理",
        },
        concurrency: {
          name: "并发任务数",
          desc: "同时执行的最大任务数",
        },
        provider: {
          title: "AI Provider 配置",
          addButton: "添加 Provider",
          addDesc: "配置 AI 服务提供商（支持 OpenAI 标准格式，可通过自定义端点兼容其他服务）",
          noProvider: "尚未配置任何 Provider。请添加至少一个 Provider 以使用插件功能。",
          addFirstProvider: "点击上方按钮添加您的第一个 AI Provider",
          defaultProvider: "默认 Provider",
          defaultProviderDesc: "选择默认使用的 AI Provider",
          testConnection: "测试连接",
          setDefault: "设为默认",
          status: "状态",
          enabled: "启用",
          disabled: "禁用",
          model: "模型",
        },
        importExport: {
          title: "导入导出",
          export: "导出",
          exportDesc: "导出当前配置为 JSON 文件",
          import: "导入",
          importDesc: "从 JSON 文件导入配置",
          reset: "重置",
          resetDesc: "将所有设置重置为默认值",
        },
        advanced: {
          title: "高级设置",
          namingTemplate: {
            name: "命名模板",
            desc: "笔记文件名模板。支持的占位符：{{chinese}} (中文名), {{english}} (英文名), {{type}} (类型英文), {{type_cn}} (类型中文), {{uid}} (唯一标识符)",
          },
          directoryScheme: {
            title: "目录方案",
            desc: "为每种知识类型配置存储目录",
          },
          taskModels: {
            title: "任务模型配置",
            desc: "为不同任务类型配置使用的模型和参数",
            providerAndModel: "Provider 和模型",
            useDefaultProvider: "使用默认 Provider",
            configureProviderFirst: "请先配置 Provider",
            modelName: "模型名称",
            modelNamePlaceholder: "模型名称",
            notSet: "不设置",
            low: "低",
            medium: "中",
            high: "高",
            advancedParams: "高级参数配置",
          },
          temperature: {
            name: "Temperature",
            desc: "控制生成内容的随机性 (0-2)，较低值更确定，较高值更创意",
          },
          topP: {
            name: "Top P",
            desc: "核采样参数 (0-1)，控制生成内容的多样性",
          },
          reasoningEffort: {
            name: "Reasoning Effort",
            desc: "推理强度（用于支持推理的模型，如 o1, o3）",
          },
          deduplication: {
            title: "去重参数",
            topK: "检索数量 (TopK)",
            topKDesc: "去重检测时检索的候选数量",
          },
          embedding: {
            title: "嵌入参数",
            dimension: "向量维度",
            dimensionDesc: "嵌入向量的维度（text-embedding-3-small 支持 256-3072）",
            dimensionWarning: "修改维度后需要重建向量索引，现有的向量数据将失效",
          },
          features: {
            title: "功能开关",
            enableGrounding: "启用校验",
            enableGroundingDesc: "在撰写完成后执行校验验证（会增加一次 LLM 调用）",
          },
          queue: {
            title: "队列参数",
            autoRetry: "自动重试",
            autoRetryDesc: "任务失败时自动重试",
            maxRetryAttempts: "最大重试次数",
            maxRetryAttemptsDesc: "任务失败时的最大重试次数",
            taskTimeout: "任务超时时间",
            taskTimeoutDesc: "单个任务的最大执行时长（毫秒，默认 1800000 = 30分钟）",
            maxTaskHistory: "任务历史上限",
            maxTaskHistoryDesc: "保留的已完成/失败/取消任务数量上限（默认 300）",
            providerTimeout: "Provider 请求超时",
            providerTimeoutDesc: "API 请求的超时时间（毫秒，默认 1800000 = 30分钟）",
          },
          logging: {
            title: "日志设置",
            logLevel: "日志级别",
            logLevelDesc: "设置日志记录的详细程度",
            clearLogs: "清除日志",
            clearLogsDesc: "清空所有日志文件",
            levels: {
              debug: "调试",
              info: "信息",
              warn: "警告",
              error: "错误",
            },
          },
        },
      },
      setupWizard: {
        title: "配置 AI Provider",
      },
      modals: {
        addProvider: {
          title: "添加 AI Provider",
        },
        editProvider: {
          title: "编辑 AI Provider",
        },
      },
      notices: {
        providerAdded: "Provider {id} 已添加",
        providerUpdated: "Provider {id} 已更新",
        providerDeleted: "Provider {id} 已删除",
        providerSetDefault: "默认 Provider 已设置为: {id}",
        connectionSuccess: "连接成功！\n聊天: {chat}\n嵌入: {embedding}\n可用模型: {models} 个",
        connectionFailed: "连接失败: {error}",
        settingsExported: "配置已导出",
        settingsImported: "配置已导入",
        settingsReset: "配置已重置",
        logsCleared: "日志已清除",
        noLogsToClean: "没有日志文件需要清除",
        languageChanged: "语言已切换为: {language}",
        logLevelChanged: "日志级别已设置为: {level}（将在下次启动时生效）",
        groundingEnabled: "校验已启用",
        groundingDisabled: "校验已禁用",
        networkRestored: "网络已恢复，队列可继续运行",
        networkOffline: "AI 服务离线，队列已暂停",
      },
      confirmDialogs: {
        deleteProvider: {
          title: "删除 Provider",
          message: "确定要删除 Provider \"{id}\" 吗？此操作不可撤销。",
        },
        resetSettings: {
          title: "重置设置",
          message: "确定要重置所有设置吗？此操作不可撤销。",
        },
        deleteDuplicatePair: {
          title: "确认删除",
          message: "确定要永久删除这个重复对记录吗？此操作不可撤销。",
        },
      },
      taskTypes: {
        define: {
          name: "定义",
          desc: "标准化输入并确定知识类型",
        },
        tag: {
          name: "标记",
          desc: "生成别名与标签",
        },
        index: {
          name: "索引",
          desc: "生成语义向量以便检索",
        },
        write: {
          name: "撰写",
          desc: "生成完整正文或合并内容",
        },
        verify: {
          name: "校验",
          desc: "验证生成内容的准确性",
        },
      },
      crTypes: {
        Domain: "领域",
        Issue: "议题",
        Theory: "理论",
        Entity: "实体",
        Mechanism: "机制",
      },
      crTypeDirectories: {
        Domain: "知识领域的存储目录。默认: 1-领域，支持相对路径如 CR/1-领域",
        Issue: "问题议题的存储目录。默认: 2-议题，支持相对路径如 CR/2-议题",
        Theory: "理论学说的存储目录。默认: 3-理论，支持相对路径如 CR/3-理论",
        Entity: "实体对象的存储目录。默认: 4-实体，支持相对路径如 CR/4-实体",
        Mechanism: "机制原理的存储目录。默认: 5-机制，支持相对路径如 CR/5-机制",
      },
      taskModels: {
        title: "任务模型配置",
        resetAll: "重置全部",
        resetAllConfirm: "确定要将所有任务配置重置为默认值吗？此操作不可撤销。",
        reset: "重置",
        resetConfirm: "确定要将此任务配置重置为默认值吗？",
        isDefault: "默认值",
        isCustom: "自定义",
        recommended: "推荐",
        fields: {
          provider: "Provider",
          providerDesc: "选择 AI Provider（留空则使用默认 Provider）",
          useDefaultProvider: "使用默认 Provider",
          model: "模型名称",
          modelDesc: "指定使用的模型（如 gpt-4o, claude-3-opus）",
          temperature: "Temperature",
          temperatureDesc: "控制生成内容的随机性 (0-2)，较低值更确定，较高值更创意",
          topP: "Top P",
          topPDesc: "核采样参数 (0-1)，控制生成内容的多样性",
          reasoningEffort: "推理强度",
          reasoningEffortDesc: "用于支持推理的模型（如 o1, o3）",
          embeddingDimension: "嵌入维度",
          embeddingDimensionDesc: "向量嵌入的维度大小",
        },
        tasks: {
          define: { name: "Define (定义)", desc: "分析和定义概念的核心含义" },
          tag: { name: "Tag (标记)", desc: "标记和分类概念" },
          write: { name: "Write (撰写)", desc: "撰写和扩展概念内容" },
          index: { name: "Index (索引)", desc: "生成语义向量并建立索引" },
          verify: { name: "Verify (校验)", desc: "验证和检查概念质量" },
        },
        reasoningEffortOptions: {
          notSet: "不设置",
          low: "低",
          medium: "中",
          high: "高",
        },
        validation: {
          temperature: "Temperature 需在 0-2 之间",
          topP: "Top P 需在 0-1 之间",
        }
      },
      imageGeneration: {
        title: "图片生成设置",
        enabled: { name: "启用图片生成", desc: "允许在笔记中插入 AI 生成的图片" },
        defaultSize: {
          name: "默认图片尺寸",
          desc: "生成图片的默认尺寸",
          square: "正方形 (1024×1024)",
          landscape: "横向 (1792×1024)",
          portrait: "纵向 (1024×1792)"
        },
        defaultQuality: {
          name: "图片质量",
          desc: "standard: 标准质量，hd: 高清质量（消耗更多 token）",
          standard: "标准",
          hd: "高清"
        },
        defaultStyle: {
          name: "图片风格",
          desc: "vivid: 鲜艳生动，natural: 自然真实",
          vivid: "鲜艳",
          natural: "自然"
        },
        defaultAspectRatio: {
          name: "宽高比",
          desc: "Gemini 预览 API 使用的宽高比，例如 1:1 或 16:9"
        },
        defaultImageSize: {
          name: "输出分辨率",
          desc: "传给 image_config.image_size 的值（如 2K/1K 或 1024x1024）"
        },
        contextWindowSize: {
          name: "上下文窗口大小",
          desc: "读取光标前后用于提示词的字符数"
        }
      }
    };
  }

  /**
   * 获取英文翻译
   */
  private getEnTranslations(): Translations {
    return {
      common: {
        confirm: "Confirm",
        cancel: "Cancel",
        save: "Save",
        delete: "Delete",
        edit: "Edit",
        add: "Add",
        close: "Close",
        loading: "Loading...",
        success: "Success",
        error: "Error",
        warning: "Warning",
      },
      workbench: {
        title: "Workbench",
      buttons: {
        improveNote: "Improve Current Note",
        deepen: "Deepen Current Note",
        insertImage: "Insert Image",
      },
        createConcept: {
          title: "Create Concept",
          placeholder: "Enter concept description...",
          startButton: "Start",
          defining: "Defining...",
          selectType: "Please select concept type",
          create: "Create",
        },
        duplicates: {
          title: "Duplicate Concepts",
          sortBy: "Sort by:",
          sortSimilarityDesc: "Similarity (High to Low)",
          sortSimilarityAsc: "Similarity (Low to High)",
          sortTimeDesc: "Time (New to Old)",
          sortTimeAsc: "Time (Old to New)",
          sortByType: "By Type",
          filterBy: "Type:",
          filterAll: "All",
          selectAll: "Select All",
          batchMerge: "Batch Merge",
          batchDismiss: "Batch Dismiss",
          viewHistory: "View History",
          empty: "No duplicate concepts",
          merge: "Merge",
          dismiss: "Dismiss",
          selectPair: "Select duplicate pair",
        },
        queueStatus: {
          title: "Queue Status",
          active: "Active",
          paused: "Paused",
          pending: "Pending",
          running: "Running",
          completed: "Completed",
          failed: "Failed",
          cancelled: "Cancelled",
          clearCompleted: "Clear Completed",
          clearFailed: "Clear Failed",
          retryFailed: "Retry Failed",
          pauseQueue: "Pause Queue",
          resumeQueue: "Resume Queue",
          viewDetails: "View Details",
          currentPipeline: "Current Pipeline",
          noPipeline: "No active pipeline",
          queuePaused: "Queue paused",
          queueRunning: "Queue running",
          queueResumed: "Queue resumed",
          cancel: "Cancel",
          retry: "Retry",
          taskId: "Task ID",
          type: "Type",
          status: "Status",
          progress: "Progress",
          actions: "Actions",
          noTasks: "No tasks in queue",
          noteName: "Note Name",
        },
        recentOps: {
          title: "Operation History",
          empty: "No operations to undo",
          undo: "Undo",
          viewSnapshot: "View Snapshot",
          refresh: "Refresh",
          clearAll: "Clear All",
          clearAllConfirmTitle: "Confirm Clear",
          clearAllConfirmMessage: "Are you sure you want to clear all snapshots? This action cannot be undone.",
          moreSnapshots: "{count} more older snapshots",
          timeJustNow: "Just now",
          timeMinutesAgo: "{minutes} minutes ago",
          timeHoursAgo: "{hours} hours ago",
          timeDaysAgo: "{days} days ago",
        },
        pipeline: {
          id: "ID",
          type: "Type",
          stage: "Stage",
          view: "View",
          confirmCreate: "Confirm Create",
        previewWrite: "Preview Write",
        groundingResult: "Verification Result:",
        chineseName: "Chinese Name:",
        englishName: "English Name:",
        autoSelect: "Auto Select",
        saveEdit: "Save Edit",
        generatedContentPreview: "Generated Content Preview (before write)",
        progressTitle: "AI Progress",
        progressHint: "Live view of LLM stages and write status",
        empty: "No pipelines are currently running",
        kind: {
          create: "Create",
          incremental: "Incremental Edit",
          merge: "Merge",
        },
        stages: {
          idle: "Idle",
          defining: "Defining",
          tagging: "Tagging",
          indexing: "Indexing",
          review_draft: "Review Draft",
          writing: "Writing",
          verifying: "Verifying",
          review_changes: "Review Changes",
          saving: "Saving",
          checking_duplicates: "Checking Duplicates",
          completed: "Completed",
          failed: "Failed",
        },
        stageMessages: {
          default: "AI is processing this stage",
          idle: "Waiting for a new task",
          defining: "Analyzing the input and finishing the definition",
          tagging: "Generating aliases, tags, and related context",
          indexing: "Creating semantic vectors for search",
          review_draft: "Waiting for draft confirmation",
          writing: "Generating or merging note content",
          verifying: "Running verification to ensure reliability",
          review_changes: "Waiting for confirmation before writing to disk",
          saving: "Writing to the vault and creating a snapshot",
          checking_duplicates: "Refreshing duplicate indices and cleaning up",
          completed: "Pipeline finished successfully. You can undo from history.",
          failed: "Pipeline failed. See the error for details.",
        },
      },
        typeConfidenceTable: {
          type: "Type",
          standardName: "Standard Name",
          confidence: "Confidence",
          action: "Action",
        },
        duplicatePreview: {
          title: "Duplicate Concept Preview",
          similarity: "Similarity:",
          type: "Type:",
          detectedAt: "Detected At:",
        },
        duplicateHistory: {
          title: "Duplicate Pair History",
        },
        notifications: {
          systemNotInitialized: "System not initialized",
          enterDescription: "Please enter concept description",
          standardizeFailed: "Definition failed",
          standardizeComplete: "Definition complete, please select type",
          pluginNotInitialized: "Plugin not initialized",
          openMarkdownFirst: "Please open a Markdown note first",
          createFailed: "Creation failed",
          conceptCreated: "Concept creation started",
          selectDuplicates: "Please select duplicates to merge first",
          batchMergeConfirm: "Confirm merging selected duplicate pairs?",
          batchMergeComplete: "Batch merge complete",
          batchDismissConfirm: "Confirm dismissing selected duplicate pairs?",
          batchDismissComplete: "Batch dismiss complete",
          fileNotFound: "File not found",
          previewFailed: "Failed to show preview",
          mergeTaskCreated: "Merge task created",
          duplicateManagerNotInitialized: "Duplicate manager not initialized",
          orchestratorNotInitialized: "Pipeline orchestrator not initialized",
          dismissFailed: "Dismiss failed",
          dismissSuccess: "Duplicate pair dismissed",
          queueResumed: "Queue resumed",
          queuePaused: "Queue paused",
          taskCancelled: "Task cancelled",
          cancelFailed: "Cancel failed",
          retryComplete: "Failed tasks retried",
          clearComplete: "Tasks cleared",
          undoFailed: "Undo failed",
          undoSuccess: "Undo successful",
          undoSuccessRestored: "Undo successful (file restored)",
          confirmCreateFailed: "Confirm create failed",
          confirmCreateWaiting: "Creation confirmed, waiting for content generation",
          standardizeUpdated: "Definition result updated",
          undoDismissSuccess: "Dismiss undone, duplicate pair restored to pending list",
          deletePairSuccess: "Duplicate pair record deleted",
          writeFailed: "Write failed",
          writeSuccess: "Written, undo available",
          writePreviewFailed: "Cannot generate write preview",
          mergeCancelled: "Merge cancelled",
          mergeStarted: "Merge task started. Please wait for AI to finish.",
          improveStarted: "Improvement task started. Please wait for AI to finish.",
          imageTaskCreated: "Image generation task queued",
          imageGenerationFailed: "Failed to start image generation",
          featureDisabled: "Feature is disabled",
        },
      },
      deepen: {
        titlePrefix: "Deepen: ",
        stats: {
          total: "Total",
          creatable: "Creatable",
          existing: "Existing",
          invalid: "Not creatable",
        },
        selectAll: "Select All",
        deselectAll: "Deselect All",
        confirm: "Create Selected",
        empty: "No candidates",
        status: {
          existing: "Existing",
          invalid: "Not creatable",
        },
        looseStructureHint: "No standard sections found. Fallback scan may miss items.",
        abstractTitlePrefix: "Abstract: ",
        abstractInstruction: "Pick at least one similar concept to generate a more abstract one with the current note.",
        abstractConfirm: "Generate",
        similarity: "Similarity",
        notInitialized: "Deepen is not initialized",
        started: "Started {count} create tasks",
        startedWithFailures: "Started {started} tasks, {failed} failed to start",
      },
      settings: {
        title: "Cognitive Razor Settings",
        tabs: {
          general: "General",
          providers: "AI Providers",
          knowledge: "Knowledge",
          system: "System"
        },
        groups: {
          interface: "Interface",
          deduplication: "Deduplication",
          performance: "Performance",
          directory: "Directory Structure",
          typeDirectories: "Type Directories",
          vectorEmbedding: "Vector Embedding",
          taskModels: "Task Models",
          snapshots: "Snapshots & Undo",
          logging: "Logging",
          dataManagement: "Data Management"
        },
        language: {
          name: "Language",
          desc: "Select interface language",
          zh: "中文",
          en: "English",
        },
        similarityThreshold: {
          name: "Similarity Threshold",
          desc: "Similarity threshold for detecting duplicate concepts (0-1)",
        },
        maxSnapshots: {
          name: "Max Snapshots",
          desc: "Maximum number of snapshots for undo operations",
        },
        maxSnapshotAgeDays: {
          name: "Snapshot Retention Days",
          desc: "Snapshots older than this will be automatically cleaned up",
        },
        concurrency: {
          name: "Concurrency",
          desc: "Maximum number of concurrent tasks",
        },
        provider: {
          title: "AI Provider Configuration",
          addButton: "Add Provider",
          addDesc: "Configure AI service provider (supports OpenAI standard format, compatible with other services via custom endpoint)",
          noProvider: "No provider configured yet. Please add at least one provider to use plugin features.",
          addFirstProvider: "Click the button above to add your first AI Provider",
          defaultProvider: "Default Provider",
          defaultProviderDesc: "Select the default AI provider",
          testConnection: "Test Connection",
          setDefault: "Set as Default",
          status: "Status",
          enabled: "Enabled",
          disabled: "Disabled",
          model: "Model",
        },
        importExport: {
          title: "Import/Export",
          export: "Export",
          exportDesc: "Export current configuration as JSON file",
          import: "Import",
          importDesc: "Import configuration from JSON file",
          reset: "Reset",
          resetDesc: "Reset all settings to default values",
        },
        advanced: {
          title: "Advanced Settings",
          namingTemplate: {
            name: "Naming Template",
            desc: "Note filename template. Supported placeholders: {{chinese}} (Chinese name), {{english}} (English name), {{type}} (type in English), {{type_cn}} (type in Chinese), {{uid}} (unique identifier)",
          },
          directoryScheme: {
            title: "Directory Scheme",
            desc: "Configure storage directory for each knowledge type",
          },
          taskModels: {
            title: "Task Model Configuration",
            desc: "Configure models and parameters for different task types",
            providerAndModel: "Provider and Model",
            useDefaultProvider: "Use Default Provider",
            configureProviderFirst: "Please configure Provider first",
            modelName: "Model Name",
            modelNamePlaceholder: "Model name",
            notSet: "Not Set",
            low: "Low",
            medium: "Medium",
            high: "High",
            advancedParams: "Advanced Parameters",
          },
          temperature: {
            name: "Temperature",
            desc: "Controls randomness of generated content (0-2), lower values are more deterministic, higher values are more creative",
          },
          topP: {
            name: "Top P",
            desc: "Nucleus sampling parameter (0-1), controls diversity of generated content",
          },
          reasoningEffort: {
            name: "Reasoning Effort",
            desc: "Reasoning intensity (for models that support reasoning, such as o1, o3)",
          },
          deduplication: {
            title: "Deduplication Parameters",
            topK: "Top K",
            topKDesc: "Number of candidates to retrieve during deduplication detection",
          },
          embedding: {
            title: "Embedding Parameters",
            dimension: "Vector Dimension",
            dimensionDesc: "Embedding vector dimension (text-embedding-3-small supports 256-3072)",
            dimensionWarning: "Changing dimension requires rebuilding vector index, existing vector data will be invalidated",
          },
          features: {
            title: "Feature Toggles",
            enableGrounding: "Enable Verification",
            enableGroundingDesc: "Run verification after writing (adds one LLM call)",
          },
          queue: {
            title: "Queue Parameters",
            autoRetry: "Auto Retry",
            autoRetryDesc: "Automatically retry failed tasks",
            maxRetryAttempts: "Max Retry Attempts",
            maxRetryAttemptsDesc: "Maximum number of retry attempts for failed tasks",
            taskTimeout: "Task Timeout",
            taskTimeoutDesc: "Maximum execution time for a single task (milliseconds, default 1800000 = 30 minutes)",
            maxTaskHistory: "Max Task History",
            maxTaskHistoryDesc: "Maximum number of completed/failed/cancelled tasks to retain (default 300)",
            providerTimeout: "Provider Request Timeout",
            providerTimeoutDesc: "Timeout for API requests (milliseconds, default 1800000 = 30 minutes)",
          },
          logging: {
            title: "Logging Settings",
            logLevel: "Log Level",
            logLevelDesc: "Set the verbosity of logging",
            clearLogs: "Clear Logs",
            clearLogsDesc: "Clear all log files",
            levels: {
              debug: "Debug",
              info: "Info",
              warn: "Warning",
              error: "Error",
            },
          },
        },
      },
      setupWizard: {
        title: "Configure AI Provider",
      },
      modals: {
        addProvider: {
          title: "Add AI Provider",
        },
        editProvider: {
          title: "Edit AI Provider",
        },
      },
      notices: {
        providerAdded: "Provider {id} added",
        providerUpdated: "Provider {id} updated",
        providerDeleted: "Provider {id} deleted",
        providerSetDefault: "Default provider set to: {id}",
        connectionSuccess: "Connection successful!\nChat: {chat}\nEmbedding: {embedding}\nAvailable models: {models}",
        connectionFailed: "Connection failed: {error}",
        settingsExported: "Settings exported",
        settingsImported: "Settings imported",
        settingsReset: "Settings reset",
        logsCleared: "Logs cleared",
        noLogsToClean: "No log files to clean",
        languageChanged: "Language changed to: {language}",
        logLevelChanged: "Log level set to: {level} (will take effect on next startup)",
        groundingEnabled: "Verification enabled",
        groundingDisabled: "Verification disabled",
        networkRestored: "Network restored, queue can continue",
        networkOffline: "AI service offline, queue paused",
      },
      confirmDialogs: {
        deleteProvider: {
          title: "Delete Provider",
          message: "Are you sure you want to delete provider \"{id}\"? This action cannot be undone.",
        },
        resetSettings: {
          title: "Reset Settings",
          message: "Are you sure you want to reset all settings? This action cannot be undone.",
        },
        deleteDuplicatePair: {
          title: "Confirm Delete",
          message: "Are you sure you want to permanently delete this duplicate pair record? This action cannot be undone.",
        },
      },
      taskTypes: {
        define: {
          name: "Define",
          desc: "Normalize the input and determine the concept type",
        },
        tag: {
          name: "Tag",
          desc: "Generate aliases and tags",
        },
        index: {
          name: "Index",
          desc: "Produce semantic vectors for retrieval",
        },
        write: {
          name: "Write",
          desc: "Generate full content or merge results",
        },
        verify: {
          name: "Verify",
          desc: "Check the accuracy of generated content",
        },
      },
      crTypes: {
        Domain: "Domain",
        Issue: "Issue",
        Theory: "Theory",
        Entity: "Entity",
        Mechanism: "Mechanism",
      },
      crTypeDirectories: {
        Domain: "Storage directory for knowledge domains. Default: 1-领域, supports relative paths like CR/1-领域",
        Issue: "Storage directory for issues. Default: 2-议题, supports relative paths like CR/2-议题",
        Theory: "Storage directory for theories. Default: 3-理论, supports relative paths like CR/3-理论",
        Entity: "Storage directory for entities. Default: 4-实体, supports relative paths like CR/4-实体",
        Mechanism: "Storage directory for mechanisms. Default: 5-机制, supports relative paths like CR/5-机制",
      },
      taskModels: {
        title: "Task Model Configuration",
        resetAll: "Reset All",
        resetAllConfirm: "Are you sure you want to reset all task configurations to default values? This action cannot be undone.",
        reset: "Reset",
        resetConfirm: "Are you sure you want to reset this task configuration to default values?",
        isDefault: "Default",
        isCustom: "Custom",
        recommended: "Recommended",
        fields: {
          provider: "Provider",
          providerDesc: "Select AI Provider (leave empty to use default Provider)",
          useDefaultProvider: "Use Default Provider",
          model: "Model Name",
          modelDesc: "Specify the model to use (e.g., gpt-4o, claude-3-opus)",
          temperature: "Temperature",
          temperatureDesc: "Controls randomness (0-2), lower values are more deterministic, higher values are more creative",
          topP: "Top P",
          topPDesc: "Nucleus sampling parameter (0-1), controls diversity",
          reasoningEffort: "Reasoning Effort",
          reasoningEffortDesc: "For models that support reasoning (e.g., o1, o3)",
          embeddingDimension: "Embedding Dimension",
          embeddingDimensionDesc: "Dimension size for vector embeddings",
        },
        tasks: {
          define: { name: "Define", desc: "Analyze and define core concept meaning" },
          tag: { name: "Tag", desc: "Tag and categorize concepts" },
          write: { name: "Write", desc: "Write and expand concept content" },
          index: { name: "Index", desc: "Generate semantic vectors and build index" },
          verify: { name: "Verify", desc: "Validate and check concept quality" },
        },
        reasoningEffortOptions: {
          notSet: "Not Set",
          low: "Low",
          medium: "Medium",
          high: "High",
        },
        validation: {
          temperature: "Temperature must be between 0 and 2",
          topP: "Top P must be between 0 and 1",
        }
      },
      imageGeneration: {
        title: "Image Generation",
        enabled: { name: "Enable image generation", desc: "Allow inserting AI-generated images into notes" },
        defaultSize: {
          name: "Default image size",
          desc: "Default canvas size when generating images",
          square: "Square (1024×1024)",
          landscape: "Landscape (1792×1024)",
          portrait: "Portrait (1024×1792)"
        },
        defaultQuality: {
          name: "Image quality",
          desc: "standard: standard quality, hd: high quality (costs more tokens)",
          standard: "Standard",
          hd: "HD"
        },
        defaultStyle: {
          name: "Image style",
          desc: "vivid: vibrant, natural: realistic",
          vivid: "Vivid",
          natural: "Natural"
        },
        defaultAspectRatio: {
          name: "Aspect ratio",
          desc: "Aspect ratio for Gemini image preview API, e.g., 1:1 or 16:9"
        },
        defaultImageSize: {
          name: "Output resolution",
          desc: "Value passed to image_config.image_size (e.g., 2K/1K or 1024x1024)"
        },
        contextWindowSize: {
          name: "Context window size",
          desc: "Characters before/after cursor to include in prompt"
        }
      }
    };
  }
}

/**
 * 格式化消息（支持插值）
 */
export function formatMessage(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key]?.toString() || match;
  });
}
