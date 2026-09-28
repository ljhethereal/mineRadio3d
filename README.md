# MineRadio3D Player

一个基于 Electron + React + TypeScript + Three.js 的本地音乐/视频播放器，支持 3D 粒子音频可视化效果。

## 功能

- 导入本地音频和视频文件（支持多选）
- 导入整个文件夹（自动过滤媒体文件）
- 播放列表：添加、删除、双击播放
- 播放控制：播放/暂停、上一首、下一首、进度拖动、音量调节
- 播放模式：顺序播放、列表循环、单曲循环、随机播放
- 3D 粒子音频可视化：随低音、中音、高音实时变化
- 可视化界面中间显示 3D 纵深音频名称（本地显示文件名，B 站显示视频标题）
- B 站视频搜索：搜索 B 站视频并仅播放音频流
- 自动记住本地文件路径和 B 站视频信息，重启后恢复播放列表

## 技术栈

- Electron 30
- React 18
- TypeScript 5
- Vite（electron-vite）
- Three.js

## 安装和运行

项目已配置国内 npm 镜像。打开 CMD 或 PowerShell：

```bash
cd E:\test

# 第一次安装
npm install

# 开发模式运行
npm run dev

# 构建应用
npm run build

# 打包为可执行安装包
npm run dist
```

如果 `npm install` 卡住，通常是 electron 二进制下载慢，见下方「常见问题」。

## 项目结构

```
E:/test/
├── electron.vite.config.ts   # electron-vite 配置
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── electron-builder.yml      # 打包配置
├── .npmrc                    # npm 镜像配置
├── README.md
└── src/
│   ├── main/                 # Electron 主进程
│   │   └── index.ts
│   ├── preload/              # 预加载脚本
│   │   └── index.ts
│   └── renderer/             # 渲染进程（前端界面）
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── types.ts
│           ├── utils.ts
│           ├── components/
│           │   ├── Player.tsx
│           │   ├── Playlist.tsx
│           │   └── Visualizer.tsx
│           └── styles/
│               └── index.css
```

## 常见问题

### 1. npm install 卡住

electron 需要从 GitHub 下载二进制文件，国内容易卡住。项目已配置 npmmirror 镜像，通常可以解决。

如果仍然卡住，尝试删除缓存后重试：

```bash
cd E:\test
rd /s /q node_modules
rd /s /q package-lock.json
npm cache clean --force
npm install
```

### 2. 跳过 electron 下载，手动安装

如果网络实在无法下载 electron，可以先跳过二进制下载：

```bash
set ELECTRON_SKIP_BINARY_DOWNLOAD=1
npm install
```

然后手动下载对应版本的 electron zip 包放到 npm 缓存目录。具体路径会在报错信息中提示。

### 3. deprecated 警告

npm 的 deprecated 警告通常不影响运行，只是提示某些包有更新版本。本项目已将主要依赖升级到较新版本，剩余警告可以忽略。

## 使用说明

1. 运行后点击右侧「导入文件」或「导入文件夹」添加本地媒体
2. 切换到「B 站搜索」标签，输入关键词搜索视频
3. 双击搜索结果或点击播放按钮，即可仅播放该视频的音频
4. 观察中间的 3D 粒子随音乐节奏变化，以及带有空间纵深感的音频名称
5. 使用底部控制栏切换播放模式、调节音量等

> 注意：B 站资源通过网络实时获取，播放地址会随每次播放重新解析；但视频信息（BV 号、标题、封面）会持久化保存，下次启动后可直接从列表中再次播放。
