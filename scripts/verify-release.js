#!/usr/bin/env node

/**
 * 发布文件验证脚本
 * 
 * 此脚本验证发布所需的所有文件是否存在且格式正确
 */

const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

function warning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

// 验证结果
let hasErrors = false;
let hasWarnings = false;

// 1. 验证必需文件存在
info('\n1. 检查必需文件...');

const requiredFiles = [
  'main.js',
  'manifest.json',
  'styles.css',
  'README.md',
  'LICENSE',
];

for (const file of requiredFiles) {
  if (fs.existsSync(file)) {
    success(`${file} 存在`);
  } else {
    error(`${file} 不存在`);
    hasErrors = true;
  }
}

// 2. 验证 manifest.json
info('\n2. 验证 manifest.json...');

try {
  const manifestPath = 'manifest.json';
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent);

  // 检查必需字段
  const requiredFields = ['id', 'name', 'version', 'minAppVersion', 'description', 'author'];
  for (const field of requiredFields) {
    if (manifest[field]) {
      success(`${field}: ${manifest[field]}`);
    } else {
      error(`缺少必需字段: ${field}`);
      hasErrors = true;
    }
  }

  // 检查版本号格式
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (versionRegex.test(manifest.version)) {
    success(`版本号格式正确: ${manifest.version}`);
  } else {
    error(`版本号格式错误: ${manifest.version} (应为 x.y.z)`);
    hasErrors = true;
  }

  // 检查 minAppVersion 格式
  if (versionRegex.test(manifest.minAppVersion)) {
    success(`minAppVersion 格式正确: ${manifest.minAppVersion}`);
  } else {
    error(`minAppVersion 格式错误: ${manifest.minAppVersion} (应为 x.y.z)`);
    hasErrors = true;
  }

  // 检查描述长度
  if (manifest.description && manifest.description.length > 0) {
    if (manifest.description.length <= 250) {
      success(`描述长度合适: ${manifest.description.length} 字符`);
    } else {
      warning(`描述过长: ${manifest.description.length} 字符 (建议 ≤ 250)`);
      hasWarnings = true;
    }
  }

  // 检查 isDesktopOnly
  if (typeof manifest.isDesktopOnly === 'boolean') {
    success(`isDesktopOnly: ${manifest.isDesktopOnly}`);
  } else {
    warning('缺少 isDesktopOnly 字段');
    hasWarnings = true;
  }

} catch (err) {
  error(`manifest.json 解析失败: ${err.message}`);
  hasErrors = true;
}

// 3. 验证 versions.json
info('\n3. 验证 versions.json...');

try {
  const versionsPath = 'versions.json';
  if (fs.existsSync(versionsPath)) {
    const versionsContent = fs.readFileSync(versionsPath, 'utf-8');
    const versions = JSON.parse(versionsContent);
    
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf-8'));
    
    if (versions[manifest.version]) {
      success(`当前版本 ${manifest.version} 已在 versions.json 中`);
      
      if (versions[manifest.version] === manifest.minAppVersion) {
        success(`版本映射正确: ${manifest.version} -> ${manifest.minAppVersion}`);
      } else {
        warning(`版本映射不一致: ${manifest.version} -> ${versions[manifest.version]} (manifest 中为 ${manifest.minAppVersion})`);
        hasWarnings = true;
      }
    } else {
      error(`当前版本 ${manifest.version} 未在 versions.json 中`);
      hasErrors = true;
    }
  } else {
    warning('versions.json 不存在');
    hasWarnings = true;
  }
} catch (err) {
  error(`versions.json 验证失败: ${err.message}`);
  hasErrors = true;
}

// 4. 验证 main.js
info('\n4. 验证 main.js...');

try {
  const mainPath = 'main.js';
  const stats = fs.statSync(mainPath);
  const sizeKB = (stats.size / 1024).toFixed(2);
  
  success(`文件大小: ${sizeKB} KB`);
  
  if (stats.size > 500 * 1024) {
    warning(`文件较大 (${sizeKB} KB)，建议检查是否包含不必要的依赖`);
    hasWarnings = true;
  }
  
  // 检查是否是有效的 JavaScript
  const content = fs.readFileSync(mainPath, 'utf-8');
  if (content.includes('use strict') || content.includes('module.exports')) {
    success('main.js 格式正确');
  } else {
    warning('main.js 可能不是有效的模块');
    hasWarnings = true;
  }
} catch (err) {
  error(`main.js 验证失败: ${err.message}`);
  hasErrors = true;
}

// 5. 验证 styles.css
info('\n5. 验证 styles.css...');

try {
  const stylesPath = 'styles.css';
  const stats = fs.statSync(stylesPath);
  const sizeKB = (stats.size / 1024).toFixed(2);
  
  success(`文件大小: ${sizeKB} KB`);
  
  const content = fs.readFileSync(stylesPath, 'utf-8');
  if (content.trim().length > 0) {
    success('styles.css 包含样式');
  } else {
    warning('styles.css 为空');
    hasWarnings = true;
  }
} catch (err) {
  error(`styles.css 验证失败: ${err.message}`);
  hasErrors = true;
}

// 6. 验证 package.json 版本一致性
info('\n6. 验证版本一致性...');

try {
  const packagePath = 'package.json';
  const packageContent = fs.readFileSync(packagePath, 'utf-8');
  const packageJson = JSON.parse(packageContent);
  
  const manifestContent = fs.readFileSync('manifest.json', 'utf-8');
  const manifest = JSON.parse(manifestContent);
  
  if (packageJson.version === manifest.version) {
    success(`版本号一致: ${packageJson.version}`);
  } else {
    error(`版本号不一致: package.json (${packageJson.version}) vs manifest.json (${manifest.version})`);
    hasErrors = true;
  }
} catch (err) {
  error(`版本一致性验证失败: ${err.message}`);
  hasErrors = true;
}

// 7. 检查 CHANGELOG.md
info('\n7. 检查 CHANGELOG.md...');

try {
  const changelogPath = 'CHANGELOG.md';
  if (fs.existsSync(changelogPath)) {
    const content = fs.readFileSync(changelogPath, 'utf-8');
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf-8'));
    
    if (content.includes(`[${manifest.version}]`)) {
      success(`CHANGELOG.md 包含当前版本 ${manifest.version}`);
    } else {
      warning(`CHANGELOG.md 未包含当前版本 ${manifest.version}`);
      hasWarnings = true;
    }
  } else {
    warning('CHANGELOG.md 不存在');
    hasWarnings = true;
  }
} catch (err) {
  warning(`CHANGELOG.md 检查失败: ${err.message}`);
  hasWarnings = true;
}

// 8. 检查 Git 状态
info('\n8. 检查 Git 状态...');

try {
  const { execSync } = require('child_process');
  
  // 检查是否有未提交的更改
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' });
    if (status.trim().length === 0) {
      success('工作区干净，没有未提交的更改');
    } else {
      warning('工作区有未提交的更改');
      hasWarnings = true;
    }
  } catch (err) {
    warning('无法检查 Git 状态（可能不是 Git 仓库）');
  }
  
  // 检查当前版本的标签是否存在
  try {
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf-8'));
    const tags = execSync('git tag', { encoding: 'utf-8' });
    
    if (tags.includes(manifest.version)) {
      success(`Git 标签 ${manifest.version} 已存在`);
    } else {
      warning(`Git 标签 ${manifest.version} 不存在（发布前需要创建）`);
      hasWarnings = true;
    }
  } catch (err) {
    warning('无法检查 Git 标签');
  }
} catch (err) {
  warning('Git 检查跳过（可能未安装 Git）');
}

// 总结
info('\n' + '='.repeat(50));
if (hasErrors) {
  error('\n验证失败！请修复上述错误后再发布。');
  process.exit(1);
} else if (hasWarnings) {
  warning('\n验证通过，但有警告。建议检查后再发布。');
  process.exit(0);
} else {
  success('\n验证通过！所有检查都已完成。');
  info('\n下一步：');
  info('1. 运行 npm test 确保所有测试通过');
  info('2. 创建 Git 标签: git tag <version>');
  info('3. 推送标签: git push origin <version>');
  info('4. 在 GitHub 上创建 Release');
  info('5. 上传 main.js, manifest.json, styles.css');
  process.exit(0);
}
