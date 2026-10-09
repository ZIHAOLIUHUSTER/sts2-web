# Android APK（最小封装）

原生 WebView 加载 APK 内的 `packages/app/dist`，包含游戏资源和 Wiki，无需游戏服务器。固定 HTTPS 本地来源让现有 fetch、WebGL、IndexedDB 存档代码原样运行；APK 不使用网站的 Service Worker 缓存。横屏、沉浸全屏；系统返回键对应游戏的 Escape，Wiki 内可返回上一页。

## 构建

需要 Node 24、pnpm 11.22.0、带 `jdk.compiler` 模块的 Java 以及 Android SDK `platforms;android-35` / `build-tools;35.0.0`。通过官方 Android SDK Manager 安装这两个组件即可，不需要 Gradle 或其他 Android 库。

```bash
pnpm install --frozen-lockfile
ANDROID_HOME=/path/to/android-sdk bash android/build.sh
```

当前云环境已准备好上述工具，直接运行 `bash android/build.sh`。默认重新构建应用及 Wiki；若刚完成 `pnpm build`，可用 `SKIP_WEB_BUILD=1 bash android/build.sh` 复用产物。

输出：`android/build/sts2-web-debug.apk`。这是调试签名的首版 APK，仅用于手动安装测试，不用于应用商店发布。安装要求 Android 8.0+、OpenGL ES 3.0 和较新的 Android System WebView。

```bash
adb install -r android/build/sts2-web-debug.apk
```

## 存档与首版范围

- APK 使用自己应用内的 WebView 存储，不会读取、覆盖手机浏览器中的存档；游戏 DTO、模型 Id、IndexedDB 名称和旧存档读取逻辑没有变化。
- 更新时保留 `android/build/debug.keystore` 和包名 `com.sts2web.game`，使用覆盖安装。删除签名文件会生成新签名，无法覆盖旧安装；卸载或清除应用数据会删除应用内存档。
- 游戏内文件导入使用系统文件选择器。首版没有额外实现 WebView 的 Blob 备份下载接口。
- APK 编译和签名已检查；真机的画面、声音、触控以及应用内保存后继续由人工验收。建议先在新档中开局，保存并退出，再关闭应用重开并继续。
