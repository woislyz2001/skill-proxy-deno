// 辰于咨询 SKILL 代理 — Deno Deploy v4（安全加固版）
// 环境变量: GITHUB_TOKEN, EXEC_KEY
// /exec 需要 EXEC_KEY 认证，/skill 已移除

const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN") || "";
const EXEC_KEY = Deno.env.get("EXEC_KEY") || "";
const GITHUB_REPO = "woislyz2001/chenyu-skills";

let catalogCache: { name: string; folder: string; path: string }[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

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
      const name = parts[parts.length - 1].replace(".md", "");
      const folder = parts.slice(0, -1).join("/");
      items.push({ name, folder, path: item.path });
    }
  }

  catalogCache = items;
  cacheTime = now;
  return items;
}

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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Exec-Key",
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const headers = corsHeaders();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // GET / — 健康检查（仅返回版本，不暴露 SKILL 数量）
  if (path === "/" && req.method === "GET") {
    return Response.json({ status: "ok" }, { headers });
  }

  // GET /skills — 列出所有 SKILL（仅名称，不含分类和路径）
  if (path === "/skills" && req.method === "GET") {
    const catalog = await buildCatalog();
    const list = catalog.map(s => s.name);
    return Response.json({ skills: list }, { headers });
  }

  // GET /exec?name=xxx — 获取完整内容（需要 EXEC_KEY）
  if (path === "/exec" && req.method === "GET") {
    if (EXEC_KEY) {
      const key = req.headers.get("X-Exec-Key") || url.searchParams.get("key") || "";
      if (key !== EXEC_KEY) {
        return Response.json({ error: "Forbidden" }, { status: 403, headers });
      }
    }

    const name = url.searchParams.get("name");
    if (!name) {
      return Response.json({ error: "Missing name" }, { status: 400, headers });
    }

    const info = await fetchSkill(name);
    if (!info) {
      return Response.json({ error: "Not found" }, { status: 404, headers });
    }

    return Response.json({
      skill: {
        name: info.name,
        content: info.content,
        folder: info.folder,
      }
    }, { headers });
  }

  // 其他路径一律 404，不暴露任何信息
  return Response.json({ error: "Not Found" }, { status: 404, headers });
});
