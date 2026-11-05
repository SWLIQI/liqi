# 第三方内容与许可声明

本仓库（liqi-video-forge / liqi）自身以 **MIT** 许可发布，全文见 [LICENSE](LICENSE)。

`references/external/` 下收录了若干开源项目的文件，用于横向调研与互证。这些文件**原样未改**，
仅在文件头加了来源与许可注记。**版权归各自作者所有，按其原始许可分发。**

---

## 一、收录清单

| 文件 | 上游仓库 | 许可 | 版权 |
|---|---|---|---|
| `awesome-seedance-style-library.json` | [LearnPrompt/awesome-seedance](https://github.com/LearnPrompt/awesome-seedance) | MIT | Copyright (c) 2026 LearnPrompt |
| `drama-skills-motion-space-layer.jsonl` | [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills) | MIT | Copyright (c) 2026 drama-skills contributors |
| `drama-skills-shots-space-layer.jsonl` | 同上 | MIT | 同上 |
| `emulsion-storyboard-blocking.md` | [dennisonbertram/emulsion](https://github.com/dennisonbertram/emulsion) | MIT | Copyright (c) 2026 Dennison Bertram |
| `environment-scene-extraction-bible.md` | [nolanx-ai/nolanx.ai](https://github.com/nolanx-ai/nolanx.ai) | MIT | Copyright (c) 2026 NolanX |
| `nolanx-dialogue-performance-blocking.md` | 同上 | MIT | 同上 |
| `nolanx-scene-blocking-and-staging.md` | 同上 | MIT | 同上 |
| `production-designer.md` | [ilkaydemiralay/vision_art_creator](https://github.com/ilkaydemiralay/vision_art_creator) | MIT | Copyright (c) 2026 İlkay Demiralay |
| `woodfantasy-director-styles.md` | [woodfantasy/Seedance-ShotDesign-Skills](https://github.com/woodfantasy/Seedance-ShotDesign-Skills) | MIT-0 | Copyright 2025 woodfantasy |
| `omer-character-design.md` | [omer-metin/skills-for-antigravity](https://github.com/omer-metin/skills-for-antigravity) | Apache-2.0 | Copyright 2026 omer-metin |
| `omer-character-design-patterns.md` | 同上 | Apache-2.0 | 同上 |
| `omer-character-design-sharp-edges.md` | 同上 | Apache-2.0 | 同上 |
| `omer-character-design-validations.md` | 同上 | Apache-2.0 | 同上 |
| `omer-creature-design.md` | 同上 | Apache-2.0 | 同上 |
| `anant-60-30-10-color.md` | [GithubAnant/skills](https://github.com/GithubAnant/skills) | MIT | Copyright (c) 2026 GithubAnant |
| `theneoai-visual-development-director.md` | [theneoai/awesome-skills](https://github.com/theneoai/awesome-skills) | MIT + 署名要求 | Copyright (c) 2026 neo.ai |

各文件均在头部注明了来源、SPDX 许可标识与版权行。上游许可文本随本文件一并提供（见第三节）。

---

## 二、已评审但未收编内容的项目

以下项目在调研过程中评审过（七份调研底稿不随本仓库分发，v5.0.0 起，下表为结论性记录）。
本仓库**未收编其任何文件或文字片段**，只记录来源与 liqi 侧独立得出的对比结论——思想与方法层面的
借鉴，著作权保护表达而不保护思想，记录自己的判断不构成侵权。已收编文件级内容的项目见第一节表格。

| 项目 | 上游许可 | 处置 |
|---|---|---|
| AntonHu/ai-drama | 未声明 | 按「保留所有权利」处理，不复制任何内容；只记来源与自有结论 |
| zenstory-ai/drama-skills | MIT | 方法论借鉴：出现记录两层分离、出现四态、身份判定四选一、身份状态对照表——已按 MIT 要求用自己的话落进资产层第五节；其 motion-specs/shots jsonl 的文件级收编见第一节 |
| whatyun/shuohao-skills | Apache-2.0 | 方法论参考：质量门阈值（主角组 1-5 / 叙事道具 ≤8）与 liqi 桥接上游（script_json_to_liqi.py）；未收编其内容 |
| chatfire-AI/huobao-drama | CC BY-NC-SA | 方法论借鉴：关键道具准入门三问与场景去重键——NC 与 MIT 冲突，未复制其任何内容，判定逻辑已在资产层第五节用自己的话重写 |
| OSideMedia/higgsfield-ai-prompt-skill | MIT | 工程派代表，评审后未收编 |
| smixs/visual-skills | CC BY 4.0 | 理论派代表，评审后未收编 |
| cclank/lanshu-awesome-ai-video-kit | 未核实 | 未收编内容则无需许可，只记结论 |
| billpar/ai-cinematic-pipeline | 未核实 | 同上 |
| VigoZhao/AI-Visual-Prompt-Cookbook | 未核实 | 同上 |
| GML-MMGroup/AdCraft | 未核实 | 同上 |
| BEIRUX/agent-skills | 未核实 | 同上 |
| Changhochien/film-production-team-skills | 未核实 | 同上 |
| elementsix/seedance-storyboard | 未核实 | 产品非提示词工程，评审时已排除 |
| inference-sh/skills | 未核实 | CLI 包装器非提示词工程，评审时已排除 |
| LocalMiniDrama | 未核实 | 产品，评审时已排除 |
| Anil-matcha/ai-creator-academy | 未核实 | 课程，评审时已排除 |
| khanhhuyenngo985-sys/character-scene-design-skills | **未声明（仓库无 LICENSE 文件）** | 方法论借鉴：剪影辨识度、视觉领地象限、原型混搭、姿态叙事、AI 色彩稳定性光谱、极端对比七型、记忆钩子、景别跳跃规则——已按「不复制文字、只重写思想」用自己的话落进 `references/资产审美_设计原理.md`；未收编其内容 |
| fal-ai-community/skills | 未声明 | 无许可，且内容为模型路由与成本档位的 API 工作流，非设计方法论，评审时已排除 |
| theneoai/awesome-skills | 自定义「MIT License with Attribution Requirement」 | 内容评审后**适合**（全片视觉统筹层，liqi 缺这一层），已于 v5.6.0 收编其 `ai-visual-development-director` 一份进第一节表格（文件头已按要求写明署名）；同仓另三个候选 `ai-colorist` / `ai-cinematographer` / `art-director` 未收编——前两个与视听层、风格锚重叠，第三个为品牌广告向，均不适合本 skill |

**许可门槛重申**：以上项目无论许可宽严，本仓库均未收编其内容，故不触发第一节的「三件齐」门槛；
若未来要收编任何一个，必须先按第一节门槛核实许可三件齐（宽松 + 允许商用 + 允许再许可），
并在文件头写入来源 / SPDX / 版权行，同时更新第一节表格。**CC BY-NC / CC BY-NC-SA 与无许可的一律不收。**
如需参考 AntonHu/ai-drama 的场景九视图规范，请自行前往上游仓库查阅。

**第四类陷阱：README 里自称有许可，但仓库里没有许可文件**（2026-10-14 新增）。

`khanhhuyenngo985-sys/character-scene-design-skills` 的 README 末尾写了
"Released under the MIT License unless a downstream package states otherwise" —— 读起来像 MIT。
但目录列表实测根目录只有 README 与几个目录，**没有任何 LICENSE 文件**，GitHub API 亦返回 `license: None`。

两个问题：一是声明不等于文件，仓库无 LICENSE 时默认「保留所有权利」；二是那句措辞本身
（「除非下游包另有说明」）把一个本应确定的授权变成了不确定，**不可依赖**。

**核实方式**：不要只读 README，要列根目录 contents 或直接探测 LICENSE / LICENSE.md / LICENSE.txt。
判定脚本不覆盖这一项，与第三类一样属于**约定**，漏了不会报警。

---

## 三、MIT 许可全文

下列项目使用同一许可文本（各自的版权行见第一节表格）：

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 四、Apache-2.0 许可全文

`omer-metin/skills-for-antigravity`（六份文件，见第一节）使用 Apache License 2.0。
按该许可第 4(a) 条，随本仓库一并提供全文如下。版权行：Copyright 2026 omer-metin。
上游无 NOTICE 文件，故无额外通告需转呈。

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or Derivative
          Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS
```

---

## 五、MIT-0（MIT No Attribution）

`woodfantasy/Seedance-ShotDesign-Skills` 使用 MIT-0：与 MIT 相同，但**不要求**保留版权声明。
本仓库仍主动标注来源与版权，仅用于说明数据出处，不构成对该项目权利的额外主张。

---

## 六、MIT + 署名要求（awesome-skills 变体）

`theneoai/awesome-skills` 使用的是一个**在 MIT 基础上追加署名条款**的自定义许可
（GitHub API 显示 `NOASSERTION`，界面标为 Other，须点开全文才见真章）。
与标准 MIT 的差异有三条，均落在「署名」而非「限制使用」上：

1. **原作者署名**：任何分发 / 修改 / 使用（整体或部分）须显示 "Based on Awesome Skills by neo.ai (lucas_hsueh@hotmail.com)"；
2. **许可证引用**：须附许可证副本或指向上游 LICENSE 的链接；
3. **修改声明**：若有修改，须明确指出。

**本仓库的履行情况**：收编文件 `theneoai-visual-development-director.md` 的文件头已写明
署名（第 1 条）、指向本节的许可副本（第 2 条）；因原样未改，无需修改声明（第 3 条）。

**为什么可以收**：该变体虽非标准 SPDX 许可，但**保留商用与再许可**，未引入 NC / SA 那类
传染性限制，符合本仓库的三件齐门槛；代价是**下游用户也须一并署名**（上述第 1 条随分发传递）。

```
MIT License with Attribution Requirement

Copyright (c) 2026 neo.ai <lucas_hsueh@hotmail.com>

About the Author / 关于作者:
- Name / 名称: neo.ai
- Identity / 身份: An AI agent and robot dedicated to creating expert skills for AI assistants
  （一个专注于为 AI 助手创建专家技能的 AI 代理和机器人）
- Email / 邮箱: lucas_hsueh@hotmail.com
- GitHub: https://github.com/theneoai
- Mission / 使命: Empowering AI assistants with expert-level knowledge across all domains
  （为所有领域的 AI 助手赋能专家级知识）

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software. 

ATTRIBUTION REQUIREMENT / 署名要求:
Any distribution, modification, or use of this Software, in whole or in part,
must retain and display the following attribution:

1. Original Author Credit / 原作者署名:
   "Based on Awesome Skills by neo.ai (lucas_hsueh@hotmail.com)"
   （基于 neo.ai 的 Awesome Skills 创建）

2. License Reference / 许可证引用:
   Include a copy of this license or reference to:
   https://github.com/theneoai/awesome-skills/blob/main/LICENSE

3. Modification Notice (if applicable) / 修改声明（如适用）:
   Clearly indicate any modifications made to the original work
   （明确指出对原作所做的任何修改）

Community / 社区:
We welcome collaboration and contributions from humans and AI agents alike!
（我们欢迎人类和 AI 代理的共同协作和贡献！）

- Contribute / 贡献: https://github.com/theneoai/awesome-skills/blob/main/CONTRIBUTING.md
- Discussions / 讨论: https://github.com/theneoai/awesome-skills/discussions
- Issues / 问题: https://github.com/theneoai/awesome-skills/issues

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

This license is based on the MIT License with additional attribution requirements
to ensure proper credit to the original AI author.
（本许可证基于 MIT 许可证，增加了额外的署名要求以确保对原始 AI 作者的适当署名。）
```

---

## 七、维护约定

新增任何第三方内容到 `references/external/` 时，必须同时：

1. 核实上游许可**三件齐**（见下表），不齐的一律不收，只记来源与自己的结论；
2. 在文件头部写入来源、SPDX 标识、版权行；
3. 更新本文件第一节表格；若为新的许可类型，补入第三 / 四 / 五 / 六节。

### 许可门槛：三件齐才可收编

| 类型 | 例 | 能否进本仓库（MIT） |
|---|---|---|
| **宽松 + 允许商用 + 允许再许可** | MIT、Apache-2.0、BSD | ✅ 可以（保留版权声明） |
| **非商业许可** | CC BY-NC-SA 4.0、CC BY-NC | ❌ **不可以** |
| **无许可** | 仓库无 LICENSE 文件 | ❌ 不可以（默认保留所有权利） |

**为什么 NC 也不能收**（2026-10-13 补，此前只写了「无 LICENSE 的一律不收」）：

NC（非商业）条款要求使用该内容的作品不得用于商业目的。本仓库是 MIT、明确允许商用——
一旦把 NC 内容复制进来，**用本 skill 接商单的下游用户就违约了**。而 BY-NC-**SA** 的
相同方式共享条款还要求衍生作品沿用同一许可，与 MIT 的宽松再许可直接冲突。

第三类陷阱最隐蔽：`chatfire-AI/huobao-drama`（16k 星）的 `scene-prompt` 内容极对口，
GitHub 界面只显示「Other」，点开 LICENSE 才发现是 CC BY-NC-SA 4.0。**必须点开看全文，不能只看 SPDX 标识。**

判定脚本不覆盖这一项——它是**约定**，不是机械门。漏了不会报警，只会在被投诉时才发现。
