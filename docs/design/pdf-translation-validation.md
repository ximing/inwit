# PDF 段落与坐标技术验证

日期：2026-11-17。状态：第 4 节样本技术门槛通过；不等于所有 PDF 均可靠，也不代替集成浏览器验收。

## 固定样本与人工核验

8 份真实论文：Attention Is All You Need、BERT、Deep Residual Learning、Adam、GPT-3、LoRA、Denoising Diffusion Probabilistic Models、CLIP。下载地址与实际文件 SHA256 在 `scripts/pdf-translation-validation/samples.json`。覆盖单栏、双栏、跨栏标题、公式、图表、脚注、图文绕排；另由真实论文页面构造扫描栅格件和 4 个旋转/CropBox/UserUnit 变体，明确不是另外的真实论文。

固定 16 页共 103 个正文目标。段落边界由 Agent 逐页阅读原页渲染标注，首尾短语与通过/缺失状态保存在 `manual-review.json`（本目录脚本内 48 个）与 `scripts/pdf-translation-acceptance/manual-review.json`（独立审阅者 55 个）。不是人工用户签字，也不是从解析结果自动生成期望。跨页只统计本页部分；同页跨栏要求同一段完整。缺失或降级仍在分母内。

最终：本组 46/48，独立组 52/55，合计 **98/103 = 95.15%**。首次独立组仅 33/55，第二轮 49/55，第三轮 52/55；未替换难样本。修复了窄双栏串栏、引用上标拆段、短行错误拆段、列表漏识别、局部绕图混入图中文字、作者与脚注误启用，以及同页跨栏断段。最终已核验启用目标未发现串栏或指向错误正文。

5 个未通过目标仍禁用正文点击：Attention 第 4 页两段含叠置分式；Diffusion 第 2 页 forward-process-variances 段、第 3 页 Now-we-discuss 与 where-C 段。保留选区翻译入口，并不宣称能从普通线性文本可靠恢复复杂分式。Attention 同页简单根式段曾丢失 √，发现后通过 TeX 运算符与邻近文字基线映射保留为 `√dk`，重新核对原页与输出后才恢复通过。

## 坐标与双引擎结果

服务端 pdfjs-dist 6.3.289；前端 EmbedPDF/PDFium 2.15.0。浏览器没有新增第二套 PDF 引擎。存储使用 `crop-local-points-v1`：未旋转 CropBox 左下原点、x 右/y 上、UserUnit 已应用的 point；保存四角与页面元数据。明确差异：pdfjs 公共 `page.view` 是 CropBox/MediaBox 交集后的有效可见框，不是原始未裁剪 PDF 字典；DTO `effectiveCropBox` 保存该值，`cropBox` 是兼容别名，`rawCropBox:null` 明示原始框未取得。没有宣称完整保留原始 CropBox，也没有为该元数据新增解析引擎。按真实逐行四边形命中，不使用跨栏包围盒。

`geometry-check.ts` 实际对 pdfjs 视口和 PDFium WASM `FPDF_PageToDevice` 执行：非零 CropBox `[30,40,580,750]`、UserUnit=2、固有旋转 0/90/180/270、查看旋转 0/90/180/270、缩放 0.5/1/2/3.25。**578 断言通过**，PDFium 整数设备坐标最大误差 **0.5995 px**。补充实际 PDFium 字符命中抽样：8 篇前 4 页共 1348 个启用行框，每行在中线横向 9 点采样均至少一次命中 PDFium 字符，跨段框中心重叠为 0（不是逐像素正确率）。最初只采 3 点时有 3 行恰落于字间空白，扩展采点后全命中，未修改段落算法。扫描 BERT 变体两引擎均无文本，parser 返回 `no_text`，不伪造点击层。

关键发现：PDFium 当前返回的页面尺寸忽略 UserUnit；UserUnit=2 仍为 550×710，而存储契约为 1100×1420。当前 document-manager 用 `normalizeRotation:true`，此模式 engine page.size 是未旋转 550×710，page.rotation=1（90°）仍保留，文本矩形已归一化为未旋转 top-left。Web 边界必须用实际页面尺寸/契约尺寸比例，再使用 SDK 页面旋转；不能再无条件乘 UserUnit 或重复应用固有旋转。`normalized-check.mjs` 已实际运行该模式，保留输出在本地 output/normalized-geometry.jsonl。

## 实际运行

从仓库根运行：

```sh
python3 scripts/pdf-translation-validation/download.py
./apps/server/node_modules/.bin/tsx scripts/pdf-translation-validation/inspect.ts
python3 scripts/pdf-translation-validation/render-review.py
# 需 pypdf、Pillow、reportlab；生成坐标/扫描变体
python3 scripts/pdf-translation-validation/make-variants.py
./apps/server/node_modules/.bin/tsx scripts/pdf-translation-validation/geometry-check.ts
node scripts/pdf-translation-validation/normalized-check.mjs
node scripts/pdf-translation-validation/hit-check.mjs
./apps/server/node_modules/.bin/vitest run --config scripts/pdf-translation-validation/unit.config.ts
```

纯逻辑测试 **6/6 通过**。unit.config.ts 是显式独立配置，不加载 server globalSetup，也不连接数据库；所有 probe 脚本无 PostgreSQL/S3/模型调用。实际 Python 依赖安装在 `/tmp/inwit-pdf-probe-venv`，可用该环境的 python 跑变体脚本。Poppler `pdftoppm` 用于视觉渲染。

下载 PDF、逐页抽取结果和 PNG 是可再生本地证据，放在脚本目录的 samples/、output/ 并 gitignore，避免把第三方全文和 43 MB 二进制加入功能提交。小型标注、来源哈希、脚本与本报告保留在仓库。

## 支持范围与限制

- 英文可提取正文、常见一栏/二栏、普通上下标与引用、可判定的同页跨栏段落；不承诺任意复杂期刊排版、竖排或多方向文本。
- 无文本扫描页不支持正文或选字翻译；不会新增 OCR 或付费调用。
- 复杂分式/乱码、低置信度、图表、脚注、参考文献和页边文字降级；选区内容属于用户显式提交，不伪装权威段落。
- 样本门槛刚超过 95%，不是通用 PDF 解析准确率保证。后续变更 parser 规则须重跑固定 103 目标，不删失败项。
- 此报告覆盖几何与抽取；真实 Web 浮层、多击、缩放、取消/重试与持久缓存由独立浏览器/集成验收报告覆盖。
