/** Build-time instrumentation only. Never imported by production main.ts. */
export function hostDiagnosticCommand(script) {
  return `
    this.addCommand({
      id: 'qa-read-only-host-transport',
      name: 'QA：只读宿主传输诊断（临时）',
      callback: () => {
        const result = ${script.trim()};
        const modal = new Modal(this.app);
        modal.titleEl.textContent = 'QA：只读宿主传输诊断';
        modal.contentEl.createEl('p', { text: '仅白名单版本、进程和能力信息。未知代理状态不等于关闭。此命令不读取服务配置，不发送请求。' });
        const area = modal.contentEl.createEl('textarea');
        area.readOnly = true;
        area.setAttribute('aria-label', '安全诊断 JSON');
        area.rows = 24;
        area.style.width = '100%';
        area.value = result;
        const select = modal.contentEl.createEl('button', { text: '全选诊断 JSON' });
        select.onclick = () => { area.focus(); area.select(); };
        modal.open();
      },
    });`;
}
