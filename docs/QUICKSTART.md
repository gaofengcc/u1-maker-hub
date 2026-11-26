# U1 Maker Hub 快速上手

## 三条命令启动

在已安装 Docker 的机器上执行下面三条命令。镜像使用 amd64 架构，ARM 主机需要开启 Docker 的 amd64 仿真。

```bash
docker pull ghcr.io/gaofengcc/u1-maker-hub:latest
docker volume create u1data
docker run -d --name u1-maker-hub -p 3000:3000 -v u1data:/data ghcr.io/gaofengcc/u1-maker-hub:latest
```

然后打开 `http://localhost:3000`。

也可以直接复制这条命令完成卷创建和启动：

```bash
docker run -d --name u1-maker-hub -p 3000:3000 -v u1data:/data ghcr.io/gaofengcc/u1-maker-hub:latest
```

## 第一次打开

1. 在“设置”中填写打印机在局域网内的地址并测试连接。
2. 在 MakerWorld 登录后，把账号 token 填入设置页。下载模型和切片需要有效 token。
3. 回到首页浏览模型。切片或发送任务前确认打印机在线。

## 演示模式

演示模式不连接 MakerWorld，也不连接打印机，适合先查看界面。删除已有容器后执行：

```bash
docker rm -f u1-maker-hub
docker run -d --name u1-maker-hub -p 3000:3000 -v u1data:/data -e DEMO_MODE=1 ghcr.io/gaofengcc/u1-maker-hub:latest
```

首页会显示演示横幅，搜索结果来自内置示例数据。设置页的保存操作会被禁用。

## 常见问题

- 打印机和运行容器的主机必须在同一局域网内。
- 当前只支持 Snapmaker U1。
- MakerWorld token 会过期，下载失败时请重新登录并更新 token。
- 遇到验证码后请等待约 30 分钟再重试，期间不要连续刷新。
- OrcaSlicer 目前只提供 Linux amd64 AppImage。arm64 主机可以通过 amd64 仿真启动容器，但切片速度会明显变慢。

## 数据目录

容器内的数据目录是 `/data`，卷 `u1data` 会持久化以下内容：

- `settings.json` 保存设置和登录凭据
- `downloads` 保存下载的模型文件
- `jobs` 保存切片和打印任务
- `history` 保存打印历史

如需使用宿主机目录，可把 compose 文件中的 `DATA_DIR` 设置为该目录，并保持容器内挂载点为 `/data`。
