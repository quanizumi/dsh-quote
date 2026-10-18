# dsh-quote

在 DeepSeek Harness 会话里拖选文字或代码，点 **引用到对话**，把选区收成输入框里的一条引用芯片。芯片只显示短预览，发送时模型收到完整原文。

npm 包名是 `dsh-add-to-chat`。对着桌面端 `0.2.0-rc.2` 的公开接口写的：

- 芯片归属 `inputTriggers.registerSource`。发送时走该 source 的 `codec.serialize`，缺了会让这次发送失败，而不是悄悄改成剪贴板文字。
- 插入走会话上的 `slash/input-insert-reference`，和 `@` 文件芯片同一条路径。
- 按钮挂在 `conversation.input.dock`。这个槽位会拿到 `useInput` 和 `sessionId`。

触发字符用的是私用区字符，不会进 `@` 或 `/` 菜单。

## 安装

仓库已包含可运行的 `lib/`，从 GitHub 安装不需要编译。把下面的 `github:quanizumi/dsh-quote#main` 装进你实际在跑的 profile（桌面端一般是 `desktop`，`dsh web` 一般是 `web`）：

```sh
dsh plugin --profile desktop add github:quanizumi/dsh-quote#main
```

`dsh` 不在 PATH 里时，用桌面端自带的命令：

```sh
"C:\path\to\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add github:quanizumi/dsh-quote#main
```

Web 端：

```sh
dsh plugin --profile web add github:quanizumi/dsh-quote#main
```

装完后重启 DeepSeek Harness（或重新执行 `dsh web`）才会生效。

卸掉：

```sh
dsh plugin --profile desktop remove dsh-add-to-chat
```

插件页可以关闭；关掉后按钮消失，`@` 文件、粘贴图片、`/` 命令菜单保持原样。

本地开发可以把仓库路径直接链进去：

```sh
dsh plugin --profile desktop add D:\dsh-quote
```

## 使用

1. 在当前会话的消息里拖选一段文字，或代码块里的若干行。
2. 松开鼠标后，选区上方出现引用按钮。拖选过程中不出现按钮。
3. 点一下。输入框末尾多一块芯片，光标回到输入框，可以接着打字。
4. 再选另一段可以再加一块。悬停时，蓝色芯片内部左侧出现 ×，点它或退格都能删掉，删掉后这条内容不会发给模型。
5. 选区消失、按 Esc、或滚动后，按钮消失。输入框里正在打的字不会被加回去。

按钮文案跟 DSH 的界面语言走。界面语言插件把当前语言写在 `<html lang>` 上：中文是 `zh-CN`，按钮显示 **引用到对话**；英文是 `en`，按钮显示 **add to chat**。`lang` 不是以 `zh` 开头时用英文。

代码块里的选区，芯片标签会带上 `language-*` 里的语言名。读不到语言名时标签是 `code ·`。发给模型的仍是选中的原文，换行保留。发出去之后，引用和你写的那句话在同一个气泡里，不带 `@`，也不把原文铺开。代码引用在气泡里只显示语言名，悬停才出现短预览。文件引用仍是原来的 `@` 芯片。

## 限制

输入框持久化的是芯片的剪贴板投影（全文），不是编辑器节点。重启应用后，还没发出去的引用可能展开成普通文字，不再是芯片。当次会话里、发出去之前，看到的仍是短标签。

## 测试

```sh
npm test
```

测的是选区换行、芯片标签，以及「草稿里每块芯片在 detect 坐标里只占 1 个字符」。没有在桌面窗口里点过按钮。
