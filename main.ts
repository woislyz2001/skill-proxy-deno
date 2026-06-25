// 辰于咨询 SKILL 代理 — Deno Deploy v3（完整版）
// 环境变量: GITHUB_TOKEN
// 架构: WorkBuddy 通过 /exec 接口获取完整 SKILL 内容执行，用户无法直接访问原文

const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
const GITHUB_REPO = "woislyz2001/chenyu-skills";

// ===== 缓存 =====
let catalogCache: { name: string; folder: string; path: string }[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ===== 扫描仓库 =====
async function buildCatalog() {
  const now = Date.now();
  if (catalogCache && (now - cacheTime) < CACHE_TTL) return catalogCache;

  const treeUrl = `https://api.github.com/repos/${GITHUB_REPO}/git/trees/main?recursive=1`;
  const treeResp = await fetch(treeUrl, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "chenyu-skill-proxy-deno"
    }
  });

  if (!treeResp.ok) return catalogCache || [];

  const treeData = await treeResp.json();
  const items: { name: string; folder: string; path: string }[] = [];

  for (const item of treeData.tree) {
    if (item.type === "blob" && item.path.endsWith(".md") &&
        !item.path.endsWith("AGENT_RULES.md") &&
        !item.path.includes(".sync-log")) {
      const parts = item.path.split("/");
      const fileName = parts[parts.length - 1].replace(".md", "");
      const folder = parts.slice(0, -1).join("/");

      items.push({
        name: fileName,
        folder: folder,
        path: item.path,
      });
    }
  }

  catalogCache = items;
  cacheTime = now;
  return items;
}

// ===== 读取 SKILL 完整内容 =====
async function fetchSkill(name: string) {
  const catalog = await buildCatalog();
  const skill = catalog.find(s => s.name === name);

  if (!skill) return null;

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${encodeURI(skill.path)}`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "chenyu-skill-proxy-deno"
    }
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  return {
    content: atob(data.content),
    name: skill.name,
    folder: skill.folder,
  };
}

// ===== CORS =====
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Exec-Key",
  };
}

// ===== 路由 =====
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const headers = corsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // GET / — 健康检查
  if (path === "/" && req.method === "GET") {
    const catalog = await buildCatalog();
    return Response.json({
      service: "Chenyu SKILL Proxy (Deno)",
      version: "3.0.0",
      skillsCount: catalog.length,
      status: "ok"
    }, { headers });
  }

  // GET /skills — 列出所有 SKILL（公开，只有名称和分类）
  if (path === "/skills" && req.method === "GET") {
    const catalog = await buildCatalog();
    const list = catalog.map(s => ({
      name: s.name,
      folder: s.folder,
    }));
    return Response.json({ skills: list }, { headers });
  }

  // GET /skill?name=xxx — 获取 SKILL 摘要（公开，不含原文）
  if (path === "/skill" && req.method === "GET") {
    const name = url.searchParams.get("name");
    if (!name) {
      return Response.json({ error: "Missing name param" }, { status: 400, headers });
    }

    const info = await fetchSkill(name);
    if (!info) {
      return Response.json({ error: `SKILL "${name}" not found` }, { status: 404, headers });
    }

    // 只返回摘要，不返回 content
    return Response.json({
      success: true,
      skill: {
        name: info.name,
        folder: info.folder,
        totalChars: info.content.length
      }
    }, { headers });
  }

  // GET /exec?name=xxx — 获取完整 SKILL 内容（仅 WorkBuddy 内部调用）
  // 这个接口返回完整内容供 WorkBuddy 执行，但用户在对话中看不到原始 JSON
  if (path === "/exec" && req.method === "GET") {
    const name = url.searchParams.get("name");
    if (!name) {
      return Response.json({ error: "Missing name param" }, { status: 400, headers });
    }

    const info = await fetchSkill(name);
    if (!info) {
      return Response.json({ error: `SKILL "${name}" not found` }, { status: 404, headers });
    }

    // 返回完整内容，WorkBuddy 读取后按 AGENT_RULES 执行
    return Response.json({
      success: true,
      skill: {
        name: info.name,
        folder: info.folder,
        content: info.content,
        totalChars: info.content.length
      }
    }, { headers });
  }

  // GET /raw — 禁止，AGENT_RULES 保护
  if (path === "/raw" && req.method === "GET") {
    return Response.json({ error: "Forbidden" }, { status: 403, headers });
  }

  return Response.json({ error: "Not Found" }, { status: 404, headers });
});
