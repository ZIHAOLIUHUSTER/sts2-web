/** Web port updates, newest first. Add both languages here; original game notes remain in assets/patch_notes. */
export const portPatchNotes: { date: string; eng: string; zhs: string }[] = [
  {
    date: '2026_10_04',
    eng: `[gold][b]Display and layout[/b][/gold]
• Added an aspect ratio setting: Auto, 4:3, 16:10, 16:9 and 21:9.
• Menus, combat, maps and other screens now adapt to the selected aspect ratio, making better use of wide and tall displays.
• Removed the blue touch highlight from the main menu's Feedback and GitHub links.

[gold][b]Touch controls[/b][/gold]
• Fixed buff descriptions disappearing while holding a status icon.
• Cards now return to your hand when released there or without a valid target; interrupted touches also cancel the drag.

[gold][b]Feedback[/b][/gold]
• Added a feedback form, opened from the main menu or the settings. Feedback goes to the web port's author, not to Mega Crit.`,
    zhs: `[gold][b]显示与布局[/b][/gold]
• 新增宽高比设置，支持自动、4:3、16:10、16:9 和 21:9。
• 主菜单、战斗、地图等界面随所选宽高比调整布局，更好地适配宽屏和较高的屏幕。
• 移除主菜单“问题反馈”和 GitHub 入口按住时的蓝色高亮。

[gold][b]触屏操作[/b][/gold]
• 修复按住状态图标时，增益或减益效果说明消失的问题。
• 卡牌在手牌区松开，或未选中有效目标时松开，会自动放回；触摸中断也会取消拖牌。

[gold][b]问题反馈[/b][/gold]
• 新增问题反馈，可从主菜单或设置中打开。反馈会发给网页版作者，不会发给 Mega Crit。`,
  },
  {
    date: '2026_10_03',
    eng: `[gold][b]Performance[/b][/gold]
• Mobile devices now start with more conservative rendering settings to reduce rendering load.
• Improved caching of game files and assets for repeat visits.

[gold][b]Fixes[/b][/gold]
• Fixed shop purchases with Lord's Parasol, including pause shortcuts while purchasing.
• Fixed combat controls in events that use the combat layout.
• Fixed the Crystal Sphere board disappearing behind its reward screen.
• Fixed the timing of the sculptor's particle effects.
• Centered reward icons and corrected the Proceed button's text styling.

[gold][b]Main menu[/b][/gold]
• Added a GitHub link and a notice identifying this project as an unofficial port.`,
    zhs: `[gold][b]性能[/b][/gold]
• 移动设备默认采用更保守的渲染设置，降低渲染负担。
• 优化游戏文件和资源的缓存，方便再次访问时复用已下载内容。

[gold][b]问题修复[/b][/gold]
• 修复持有「领主阳伞」时的商店购买流程，以及购买过程中的暂停快捷键。
• 修复使用战斗布局的事件中，战斗界面无法正常操作的问题。
• 修复「水晶球」事件打开奖励界面后，棋盘消失的问题。
• 修复雕刻师粒子特效的播放时机。
• 调整奖励图标的居中位置，并修复前进按钮的文字样式。

[gold][b]主菜单[/b][/gold]
• 新增 GitHub 入口和非官方移植说明。`,
  },
  {
    date: '2026_10_02',
    eng: `[gold][b]Controls and presentation[/b][/gold]
• Added the developer console. Press the backtick key to open or close it.
• Purchased cards now fly into the deck, and the deck counter updates after a purchase.
• Fixed the card removal selection screen in shops.
• Fixed potion popups closing as soon as they were pressed.
• Declared the game's dark color scheme to prevent browsers from darkening it again.
• Added an introduction to the web port and its GitHub project.`,
    zhs: `[gold][b]操作与表现[/b][/gold]
• 新增开发者控制台，可按反引号键打开或关闭。
• 购买的卡牌会飞入牌组，牌组数量也会随之更新。
• 修复商店移除卡牌时的选牌界面。
• 修复药水弹出菜单一按就关闭的问题。
• 声明游戏的深色配色，避免浏览器再次强制压暗画面。
• 新增网页移植版介绍及 GitHub 项目链接。`,
  },
  {
    date: '2026_10_01',
    eng: `[gold][b]The web port begins[/b][/gold]
• Released the first browser version of this unofficial port, based on Slay the Spire 2 v0.98.3.
• Added touch controls, including landscape presentation on portrait mobile screens and card dragging fixes.
• Restored full-resolution character and card artwork.
• The game initially selects a language based on your device settings; you can change it in Settings.
• Added support for installing the web app to your device's home screen.`,
    zhs: `[gold][b]网页移植版上线[/b][/gold]
• 发布首个浏览器版本，基于《杀戮尖塔 2》v0.98.3 制作的非官方移植。
• 适配触屏操作，包括手机竖屏时的横向显示，并修复卡牌拖拽问题。
• 恢复原始分辨率的角色与卡牌美术资源。
• 首次启动时根据设备设置选择游戏语言，也可在设置中手动切换。
• 支持将网页应用安装到设备主屏幕。`,
  },
];
