# Android APK（最小封装）

原生 WebView 加载 APK 内的 `packages/app/dist`，包含全部游戏资源和中英文 Wiki，无需游戏服务器。固定 HTTPS 本地来源让现有 fetch、WebGL、IndexedDB 存档代码原样运行；APK 不使用网站的 Service Worker 缓存。横屏、沉浸全屏；系统返回键对应游戏的 Escape，Wiki 内可返回上一页。

## 构建

需要 Node 24、pnpm 11.22.0、带 `jdk.compiler` 模块的 Java 以及 Android SDK `platforms;android-35` / `build-tools;35.0.0`。通过官方 Android SDK Manager 安装这两个组件即可，不需要 Gradle 或其他 Android 库。

```bash
pnpm install --frozen-lockfile
ANDROID_HOME=/path/to/android-sdk bash android/build.sh
```

当前云环境已准备好上述工具，直接运行 `bash android/build.sh`。默认重新构建应用及 Wiki，再在独立打包目录裁剪重复资源；若刚完成 `pnpm build`，可用 `SKIP_WEB_BUILD=1 bash android/build.sh` 复用产物。

推送 `android-*` 标签也会触发 `.github/workflows/android.yml`，在 GitHub Actions 上构建并发布测试 Release；自动构建使用该次任务生成的调试签名。

输出：`android/build/sts2-web-debug.apk`。这是调试签名的首版 APK，仅用于手动安装测试，不用于应用商店发布。安装要求 Android 8.0+、OpenGL ES 3.0 和较新的 Android System WebView。

```bash
adb install -r android/build/sts2-web-debug.apk
```

## 精简打包

- 应用只提供简体中文和英文；不支持的旧语言偏好安全回退到英文，旧存档格式和存储位置不变。
- `android/prepare-assets.mjs` 只裁剪打包副本：非中英文本和专属字体、MP3重复音频。原始 `assets/` 和网页构建目录不变；全部场景、角色、卡牌、动画、音效和离线 Wiki 保留。
- 默认音频用 Ogg/Opus，要求较新的 Android System WebView。如需为旧解码器保留 MP3 退路，用 `AUDIO_COMPAT=1 bash android/build.sh`；体积会增加约 96 MiB。
- APK 压缩 JS、JSON、HTML 等文字资源；已压缩的图片和音频保持打包工具默认处理。打包前验证所有音频索引/别名、中英文本、纹理和 atlas 页；体积清单在 `android/build/assets-report.json`。

## 存档与首版范围

- APK 使用自己应用内的 WebView 存储，不会读取、覆盖手机浏览器中的存档；游戏 DTO、模型 Id、IndexedDB 名称和旧存档读取逻辑没有变化。
- 更新时保留 `android/build/debug.keystore` 和包名 `com.sts2web.game`，使用覆盖安装。删除签名文件会生成新签名，无法覆盖旧安装；卸载或清除应用数据会删除应用内存档。
- 游戏内导入和导出备份使用系统文件选择器；只有备份写入成功才显示导出完成，取消不会改动存档。
- APK 编译和签名已检查；真机的画面、声音、触控以及应用内保存后继续由人工验收。建议先在新档中开局，保存并退出，再关闭应用重开并继续。

## 0.7 专用渲染与诊断

APK 使用统一动画调度，特效画布按需创建。设置 → 通用 → 性能诊断可保存报告，详见 `docs/android-rendering.md`。本地小文本采用有界进程 LRU；拦截响应不保证 WebView HTTP 缓存，不能把版本 ETag 宣传为自动提速。
