/**
 * 跨入口的设置页定位意图。
 *
 * 工作台的“先在设置中配置模型”提示要求点一下就能落到具体位置。设置标签页
 * 可能尚未挂载，因此请求先作为待处理值保存；已挂载的设置页直接收到通知。
 */
export type SettingsSectionIntent = "connections";

interface IntentChannel<T> {
  request(value: T): void;
  take(): T | undefined;
  subscribe(listener: (value: T) => void): () => void;
  clear(): void;
}

function createChannel<T>(): IntentChannel<T> {
  let pending: T | undefined;
  const listeners = new Set<(value: T) => void>();
  return {
    request(value) {
      if (listeners.size > 0) {
        for (const listener of listeners) listener(value);
        return;
      }
      pending = value;
    },
    take() {
      const value = pending;
      pending = undefined;
      return value;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      pending = undefined;
    },
  };
}

const sectionChannel = createChannel<SettingsSectionIntent>();

export function requestSettingsSection(section: SettingsSectionIntent): void {
  sectionChannel.request(section);
}

/** 返回待处理的定位请求一次；新挂载的设置页消费它。 */
export function takeSettingsSection(): SettingsSectionIntent | undefined {
  return sectionChannel.take();
}

/** 已挂载的设置页接收实时请求；返回取消订阅函数。 */
export function onSettingsSection(listener: (section: SettingsSectionIntent) => void): () => void {
  return sectionChannel.subscribe(listener);
}

export function clearSettingsSection(): void {
  sectionChannel.clear();
}
