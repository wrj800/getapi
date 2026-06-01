export type PublicModel = {
  id: string;
  label: string;
  vendor: string;
  purpose: string;
  description: string;
  badge: string;
  recommended?: boolean;
};

export const PUBLIC_MODELS: PublicModel[] = [
  {
    id: "minimaxai/minimax-m2.7",
    label: "默认聊天",
    vendor: "MiniMax",
    purpose: "日常问答",
    description: "速度和稳定性均衡，适合作为公益站默认入口。",
    badge: "均衡",
    recommended: true
  },
  {
    id: "qwen/qwen3.5-397b-a17b",
    label: "深度思考",
    vendor: "Qwen",
    purpose: "复杂问题",
    description: "适合长文分析、严肃问答和复杂推理。",
    badge: "强能力"
  },
  {
    id: "deepseek-ai/deepseek-v4-pro",
    label: "推理增强",
    vendor: "DeepSeek",
    purpose: "推理与数学",
    description: "适合逻辑推理、数学、代码解释和严谨分析。",
    badge: "推理"
  },
  {
    id: "qwen/qwen3-coder-480b-a35b-instruct",
    label: "代码编程",
    vendor: "Qwen",
    purpose: "代码任务",
    description: "适合写代码、改代码、解释报错和生成脚本。",
    badge: "代码"
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct",
    label: "快速问答",
    vendor: "Qwen",
    purpose: "高并发问答",
    description: "适合快速回复、搜索式问答和轻量任务。",
    badge: "快速"
  },
  {
    id: "qwen/qwen3.5-122b-a10b",
    label: "长文分析",
    vendor: "Qwen",
    purpose: "文档理解",
    description: "适合总结、改写、资料梳理和多段内容分析。",
    badge: "长文"
  },
  {
    id: "deepseek-ai/deepseek-v4-flash",
    label: "DeepSeek 快速版",
    vendor: "DeepSeek",
    purpose: "快速推理",
    description: "适合需要较快响应的推理和通用任务。",
    badge: "Flash"
  },
  {
    id: "z-ai/glm-5.1",
    label: "GLM 强力模型",
    vendor: "Z.ai",
    purpose: "综合能力",
    description: "适合作为国产强模型展示位，公网使用建议观察稳定性。",
    badge: "Beta"
  },
  {
    id: "openai/gpt-oss-120b",
    label: "开源强模型",
    vendor: "OpenAI OSS",
    purpose: "通用兜底",
    description: "通用能力稳定，适合作为开放模型补充选项。",
    badge: "开源"
  },
  {
    id: "mistralai/mistral-large-3-675b-instruct-2512",
    label: "海外高质量",
    vendor: "Mistral",
    purpose: "高质量写作",
    description: "适合英文、写作、总结和需要稳妥表达的任务。",
    badge: "质量"
  }
];

export const MODEL_ID_SET = new Set(PUBLIC_MODELS.map((model) => model.id));

export function getPublicModel(id: string) {
  return PUBLIC_MODELS.find((model) => model.id === id);
}
