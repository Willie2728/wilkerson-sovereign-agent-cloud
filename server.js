import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import dns from 'node:dns/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createExecutionLayer} from './src/execution-layer.js';
import {handleMcp} from './src/mcp.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const generatedDir = path.join(publicDir, 'generated');
const sovereignStateFile = path.join(root, 'sovereign-state.json');
const execFileAsync = promisify(execFile);
const port = Number(globalThis.process?.env?.PORT || globalThis.process?.env?.WILKERSON_TOOL_PORT || 8788);
const bindAddress = String(globalThis.process?.env?.WILKERSON_BIND || (globalThis.process?.env?.RENDER ? '0.0.0.0' : '127.0.0.1'));
const accessPin = String(globalThis.process?.env?.WILKERSON_ACCESS_PIN || '').trim();
const ollamaBase = 'http://127.0.0.1:11434';
const codingModel = 'qwen2.5-coder:3b';
const visionModel = 'minicpm-v4.6:1b';
const requests = new Map();
const blockedHosts = new Set(['localhost', 'localhost.localdomain']);
const allowedOrigins = new Set([
  'null',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:8788',
  'http://localhost:8788'
]);
const executionLayer = await createExecutionLayer();
const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.webp':'image/webp', '.wav':'audio/wav',
  '.mp4':'video/mp4', '.webmanifest':'application/manifest+json'
};

const initialSovereignState = {provider:'local-demo', killed:false, workspaces:[], tasks:[], audit:[]};

async function readSovereignState() {
  try { return {...initialSovereignState, ...JSON.parse(await fs.readFile(sovereignStateFile, 'utf8'))}; }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(initialSovereignState); throw error; }
}

async function writeSovereignState(state) {
  const safe = JSON.stringify(state, null, 2);
  await fs.writeFile(sovereignStateFile, safe, {encoding:'utf8', mode:0o600});
}

function taskPlan(command) {
  const lower = command.toLowerCase();
  const plan = ['Validate requested scope and granted authority','Select an available governed workspace'];
  if (/research|website|web|browse|search/.test(lower)) plan.push('Inspect approved public sources in read-only mode');
  if (/file|save|write|document|brief|report/.test(lower)) plan.push('Create the requested artifact inside the workspace');
  plan.push('Record outputs and evidence in the audit stream','Return results to WISDOM for founder review');
  return plan;
}

function requiresApproval(command, authority) {
  if (authority === 'readonly') return false;
  return /send|publish|post|buy|purchase|pay|delete|remove|email|message|deploy|account|password|credential|transfer|submit|sign/.test(command.toLowerCase());
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
}

function gatewayAccess(request) {
  return executionLayer?.authenticate(request.headers.authorization || '');
}

function gatewayUnavailable(response) {
  return json(response, 503, {ok:false,error:'Execution layer is not configured. DATABASE_URL and GATEWAY_API_TOKEN are required.'});
}

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  });
  response.end(JSON.stringify(data));
}

function hasApiAccess(request) {
  if (!accessPin) return true;
  return String(request.headers['x-wilkerson-pin'] || '') === accessPin;
}

function privateIp(ip) {
  return /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|fe80)/i.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

async function validateTarget(raw) {
  let url;
  const input = String(raw || '').trim();
  if (!input) throw new Error('Enter a website name or address, such as youtube or youtube.com.');
  let normalized = input;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    if (/^[a-z0-9-]+$/i.test(normalized)) normalized = `https://www.${normalized.toLowerCase()}.com/`;
    else normalized = `https://${normalized.replace(/^\/+/, '')}`;
  }
  try { url = new URL(normalized); }
  catch { throw new Error('Enter a website name or address, such as youtube or youtube.com.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new Error('URLs containing credentials are blocked.');
  if (blockedHosts.has(url.hostname.toLowerCase())) throw new Error('Local and private-network targets are blocked.');
  const records = await dns.lookup(url.hostname, {all:true});
  if (!records.length || records.some(record => privateIp(record.address))) throw new Error('Private-network targets are blocked.');
  return url;
}

function robotsAllows(text, target) {
  let active = false;
  const disallow = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.split('#')[0].trim();
    const index = clean.indexOf(':');
    if (index < 0) continue;
    const key = clean.slice(0, index).trim().toLowerCase();
    const value = clean.slice(index + 1).trim();
    if (key === 'user-agent') active = value === '*';
    else if (active && key === 'disallow' && value) disallow.push(value);
  }
  return !disallow.some(rule => target.pathname.startsWith(rule));
}

async function fetchBounded(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      redirect:'follow', signal:controller.signal,
      headers:{
        'User-Agent':'WilkersonContextEngine/0.2 (+local research tool)',
        'Accept':'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5'
      },
      ...options
    });
    const size = Number(response.headers.get('content-length') || 0);
    if (size > 1_500_000) throw new Error('Response exceeds the 1.5 MB inspection limit.');
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;
    if (reader) {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 1_500_000) {
          controller.abort();
          throw new Error('Response exceeds the 1.5 MB inspection limit.');
        }
        chunks.push(value);
      }
    }
    return {response, body:Buffer.concat(chunks).toString('utf8')};
  } finally {
    clearTimeout(timer);
  }
}

function decode(value = '') {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function strip(value = '') {
  return decode(value.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function first(html, pattern) {
  const match = html.match(pattern);
  return match ? strip(match[1]) : '';
}

function all(html, pattern, limit = 20) {
  const output = [];
  let match;
  while ((match = pattern.exec(html)) && output.length < limit) {
    const value = strip(match[1]);
    if (value && !output.includes(value)) output.push(value);
  }
  return output;
}

function absoluteLinks(html, base) {
  const output = [];
  const pattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && output.length < 80) {
    try {
      const url = new URL(match[1], base).href;
      const label = strip(match[2]) || url;
      if (!output.some(item => item.url === url)) output.push({label:label.slice(0, 120), url});
    } catch {}
  }
  return output;
}

function analyze(html, url, status, elapsed, headers, mode) {
  const title = first(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = first(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || first(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const h1 = all(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, 10);
  const h2 = all(html, /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, 15);
  const result = {
    url, status, elapsedMs:elapsed, title, description,
    headings:{h1, h2}, text:strip(html).slice(0, 12_000),
    links:absoluteLinks(html, url), reviewedAt:new Date().toISOString(),
    contentType:headers.get('content-type') || ''
  };
  if (mode === 'qa') {
    result.checks = [
      {name:'HTTP success', pass:status >= 200 && status < 400, detail:`Status ${status}`},
      {name:'Page title', pass:Boolean(title), detail:title || 'Missing title'},
      {name:'Meta description', pass:Boolean(description), detail:description || 'Missing description'},
      {name:'Single primary heading', pass:h1.length === 1, detail:`Found ${h1.length} H1 headings`},
      {name:'Language declared', pass:/<html[^>]+lang=["'][^"']+/i.test(html), detail:/<html[^>]+lang=/i.test(html) ? 'Language attribute found' : 'Missing html lang attribute'},
      {name:'Mobile viewport', pass:/<meta[^>]+name=["']viewport["']/i.test(html), detail:/name=["']viewport/i.test(html) ? 'Viewport found' : 'Viewport missing'},
      {name:'Images have alt text', pass:!/<img\b(?![^>]*\balt=)[^>]*>/i.test(html), detail:!/<img\b(?![^>]*\balt=)[^>]*>/i.test(html) ? 'No obvious missing alt attributes' : 'At least one image appears to lack alt text'}
    ];
  }
  return result;
}

async function inspect(raw, mode = 'context') {
  const target = await validateTarget(raw);
  const robotsUrl = new URL('/robots.txt', target);
  try {
    const robots = await fetchBounded(robotsUrl, {headers:{'User-Agent':'WilkersonContextEngine/0.2'}});
    if (robots.response.ok && !robotsAllows(robots.body, target)) throw new Error('The site robots file disallows this path.');
  } catch (error) {
    if (error.message.includes('disallows')) throw error;
  }
  const started = Date.now();
  const {response, body} = await fetchBounded(target);
  if (!response.ok) throw new Error(`The target returned HTTP ${response.status}.`);
  if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('Only public HTML and text pages are supported.');
  return analyze(body, response.url, response.status, Date.now() - started, response.headers, mode);
}

function normalizedPageUrl(raw) {
  const url = new URL(raw);
  url.hash = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
  return url.href;
}

async function crawlSite(raw, requestedPages, requestedDepth) {
  const started = Date.now();
  const start = await validateTarget(raw);
  const maxPages = Math.min(Math.max(Number(requestedPages) || 4, 1), 8);
  const maxDepth = Math.min(Math.max(Number(requestedDepth) || 1, 0), 2);
  const origin = start.origin;
  const queue = [{url:normalizedPageUrl(start.href), depth:0}];
  const visited = new Set();
  const pages = [];
  const errors = [];
  while (queue.length && pages.length < maxPages) {
    const next = queue.shift();
    if (visited.has(next.url)) continue;
    visited.add(next.url);
    try {
      const page = await inspect(next.url, 'context');
      pages.push({...page, depth:next.depth});
      if (next.depth < maxDepth) {
        for (const link of page.links) {
          try {
            const candidate = new URL(link.url);
            if (candidate.origin !== origin || /\.(pdf|zip|png|jpe?g|gif|webp|mp4|mp3|wav|docx?|xlsx?)$/i.test(candidate.pathname)) continue;
            const normalized = normalizedPageUrl(candidate.href);
            if (!visited.has(normalized) && !queue.some(item => item.url === normalized)) queue.push({url:normalized, depth:next.depth + 1});
          } catch {}
        }
      }
    } catch (error) {
      errors.push({url:next.url, error:error.message});
    }
  }
  if (!pages.length) {
    const reason = errors[0]?.error || 'The site returned no readable public pages.';
    throw new Error(`The requested website could not be returned. ${reason}`);
  }
  return {
    requestedInput:String(raw || '').trim(), startUrl:start.href, origin, maxPages, maxDepth, pageCount:pages.length,
    pages, errors, completedAt:new Date().toISOString(),
    elapsedMs:Date.now() - started,
    boundary:'Bounded same-origin crawl; no authentication, paywall bypass, or anti-bot evasion.'
  };
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > 4_000_000) throw new Error('Request exceeds the 4 MB local limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function synthesize(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Enter text to speak.');
  if (text.length > 2_000) throw new Error('Speech text is limited to 2,000 characters.');
  await fs.mkdir(generatedDir, {recursive:true});
  const id = randomUUID();
  const textPath = path.join(generatedDir, `${id}.txt`);
  const wavPath = path.join(generatedDir, `${id}.wav`);
  const scriptPath = path.join(root, 'scripts', 'synthesize.ps1');
  await fs.writeFile(textPath, text, 'utf8');
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-TextPath', textPath, '-OutputPath', wavPath], {timeout:30_000, windowsHide:true});
    return `/generated/${id}.wav`;
  } finally {
    await fs.rm(textPath, {force:true});
  }
}

async function recognizeSpeech(audio) {
  const raw = String(audio || '');
  const wav = raw.replace(/^data:audio\/[a-z0-9.+-]+;base64,/i, '');
  if (!wav) throw new Error('Record a short dictation first.');
  if (wav.length > 3_500_000) throw new Error('Dictation is limited to about 15 seconds.');
  await fs.mkdir(generatedDir, {recursive:true});
  const id = randomUUID();
  const wavPath = path.join(generatedDir, `${id}-dictation.wav`);
  const scriptPath = path.join(root, 'scripts', 'recognize.ps1');
  await fs.writeFile(wavPath, Buffer.from(wav, 'base64'));
  try {
    const {stdout} = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-InputPath', wavPath], {timeout:45_000, windowsHide:true});
    const result = JSON.parse(String(stdout || '{}').replace(/^\uFEFF/, '').trim());
    if (!result.text) throw new Error('No speech was recognized. Speak clearly, then try again.');
    return result;
  } finally {
    await fs.rm(wavPath, {force:true});
  }
}

async function ollamaTags() {
  try {
    const response = await fetch(`${ollamaBase}/api/tags`, {signal:AbortSignal.timeout(5_000)});
    if (!response.ok) throw new Error('Ollama did not answer.');
    const data = await response.json();
    const models = (data.models || []).map(model => model.name);
    return {
      online:true, models, codingModel,
      codingReady:models.includes(codingModel), visionModel,
      visionReady:models.includes(visionModel), mode:'local-only sequential inference'
    };
  } catch {
    return {online:false, models:[], codingModel, codingReady:false, visionModel, visionReady:false, mode:'offline'};
  }
}

async function callOllama({model, prompt, images, maxTokens = 500, temperature = 0.3}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  const started = Date.now();
  try {
    const response = await fetch(`${ollamaBase}/api/generate`, {
      method:'POST', signal:controller.signal,
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model, prompt, images, stream:false, think:false, keep_alive:'2m',
        options:{num_ctx:3_072, num_predict:maxTokens, temperature}
      })
    });
    if (!response.ok) throw new Error(`Local model returned HTTP ${response.status}.`);
    const data = await response.json();
    return {text:String(data.response || '').trim(), elapsedMs:Date.now() - started, model:data.model || model};
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Local model exceeded the five-minute limit.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cleanHtml(text) {
  const cleaned = text.replace(/^```(?:html)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = cleaned.search(/<!doctype html|<html/i);
  return start >= 0 ? cleaned.slice(start) : cleaned;
}

async function buildWithForge(body) {
  const name = String(body.name || 'Wilkerson Experience').trim().slice(0, 100);
  const request = String(body.prompt || '').trim().slice(0, 4_000);
  if (!request) throw new Error('Describe the page you want to build.');
  const prompt = `You are Wilkerson Forge, a local coding engine. Create one polished, responsive, standalone HTML document for this project.\nPROJECT NAME: ${name}\nREQUEST: ${request}\nREQUIREMENTS: Return only complete HTML beginning with <!doctype html>. Put all CSS and JavaScript inside the document. Use no external libraries, remote assets, forms that transmit data, tracking, network requests, or dead buttons. Every visible button must perform a safe local interaction. Use accessible semantic HTML, strong mobile design, cinematic navy and gold visual quality, and respect prefers-reduced-motion. Keep the result under 1,100 tokens.`;
  const generated = await callOllama({model:codingModel, prompt, maxTokens:1_100, temperature:0.25});
  const html = cleanHtml(generated.text);
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) throw new Error('The small local model did not produce a complete page. Try a shorter, more specific request.');
  return {...generated, html, boundary:'Local 3B model; suitable for simple pages, not production full-stack systems.'};
}

async function personaChat(body) {
  const message = String(body.message || '').trim().slice(0, 2_000);
  if (!message) throw new Error('Enter a message.');
  const visualContext = String(body.visualContext || '').trim().slice(0, 1_500);
  const prompt = `You are WISDOM, the private local conversational guide for Wilkerson Collective. Answer the user's actual question directly in 1-4 concise sentences. Be warm, practical, and honest about uncertainty. Never claim to be Willie, never invent memories, and never imply that a camera is active unless visual context is supplied. Available local tools: focused standalone web-page generation, bounded public-site crawling, single-page extraction and QA, Windows speech and WAV export, text conversation, user-approved snapshot vision, and local camera/microphone preview. Current limits: the laptop runs one model at a time; snapshot vision is not real-time; there is no photorealistic talking-avatar lip sync, multi-device video room, generative video, or 3D motion capture yet. ${visualContext ? `Approved snapshot context: ${visualContext}` : 'No camera snapshot is available.'}\nUser: ${message}\nWISDOM:`;
  return callOllama({model:codingModel, prompt, maxTokens:220, temperature:0.55});
}

async function personaVision(body) {
  const raw = String(body.image || '');
  const image = raw.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (!image || image.length > 3_500_000) throw new Error('Provide one camera snapshot under 2.5 MB.');
  const request = String(body.prompt || 'Describe the visible scene respectfully and concisely.').trim().slice(0, 500);
  const prompt = `Analyze this user-approved camera snapshot. ${request} Do not identify people, infer protected traits, diagnose emotions or health, or claim certainty beyond visible evidence. Answer with only a concise observation.`;
  return callOllama({model:visionModel, prompt, images:[image], maxTokens:140, temperature:0.1});
}

function rateLimit(request) {
  const key = request.socket.remoteAddress || 'local';
  const now = Date.now();
  let entries = requests.get(key) || [];
  entries = entries.filter(time => now - time < 60_000);
  if (entries.length >= 30) return false;
  entries.push(now);
  requests.set(key, entries);
  return true;
}

async function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir)) return json(response, 403, {error:'Blocked path.'});
  try {
    const data = await fs.readFile(file);
    response.writeHead(200, {'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff'});
    response.end(data);
  } catch {
    json(response, 404, {error:'Not found.'});
  }
}

const server = http.createServer(async (request, response) => {
  applyCors(request, response);
  try {
    const requestUrl = new URL(request.url, 'http://local');
    const requestPath = requestUrl.pathname;
    if (request.method === 'GET' && requestPath === '/health') {
      const health = executionLayer ? await executionLayer.health() : {ok:true,status:'website_only',service:'wilkerson-sovereign-stack',executionLayer:'not_configured'};
      return json(response, health.ok ? 200 : 503, health);
    }
    if (requestPath === '/mcp') {
      if (!executionLayer) return gatewayUnavailable(response);
      if (!gatewayAccess(request)) return json(response, 401, {ok:false,error:'Bearer authentication required.'});
      if (request.method !== 'POST') return json(response, 405, {ok:false,error:'Use POST for MCP Streamable HTTP requests.'});
      const result = await handleMcp(executionLayer, await readBody(request));
      if (result === null) { response.writeHead(202, {'MCP-Protocol-Version':'2025-06-18'}); return response.end(); }
      response.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','MCP-Protocol-Version':'2025-06-18','X-Content-Type-Options':'nosniff'});
      return response.end(JSON.stringify(result));
    }
    const gatewayRoute = requestPath === '/api/capabilities' || requestPath === '/api/providers' || requestPath.startsWith('/api/providers/') || requestPath === '/api/tasks' || requestPath.startsWith('/api/tasks/') || requestPath === '/api/approvals' || requestPath.startsWith('/api/approvals/') || requestPath === '/api/audit' || requestPath === '/api/artifacts' || requestPath.startsWith('/api/artifacts/');
    if (gatewayRoute) {
      if (!executionLayer) return gatewayUnavailable(response);
      if (!gatewayAccess(request)) return json(response, 401, {ok:false,error:'Bearer authentication required.'});
      if (request.method === 'GET' && requestPath === '/api/capabilities') return json(response,200,{ok:true,...await executionLayer.capabilities()});
      if (request.method === 'GET' && requestPath === '/api/providers') return json(response,200,{ok:true,providers:await executionLayer.providersList()});
      const providerProbe = requestPath.match(/^\/api\/providers\/([^/]+)\/probe$/);
      if (request.method === 'POST' && providerProbe) return json(response,200,{ok:true,provider:await executionLayer.probeProvider(decodeURIComponent(providerProbe[1]),'api')});
      if (request.method === 'POST' && requestPath === '/api/tasks') {
        const body = await readBody(request);
        return json(response,202,{ok:true,...await executionLayer.submit({command:body.command,provider:body.provider,operation:body.operation,input:body.input,requestedBy:'api'})});
      }
      const taskMatch = requestPath.match(/^\/api\/tasks\/([0-9a-f-]+)$/i);
      if (request.method === 'GET' && taskMatch) {
        const task = await executionLayer.status(taskMatch[1]);
        return task ? json(response,200,{ok:true,task}) : json(response,404,{ok:false,error:'Task not found.'});
      }
      const taskCancel = requestPath.match(/^\/api\/tasks\/([0-9a-f-]+)\/cancel$/i);
      if (request.method === 'POST' && taskCancel) {
        const task = await executionLayer.cancel(taskCancel[1],'api');
        return task ? json(response,200,{ok:true,task}) : json(response,404,{ok:false,error:'Task not found.'});
      }
      const taskResult = requestPath.match(/^\/api\/tasks\/([0-9a-f-]+)\/result$/i);
      if (request.method === 'GET' && taskResult) {
        const result = await executionLayer.result(taskResult[1]);
        return result ? json(response,200,{ok:true,...result}) : json(response,404,{ok:false,error:'Task not found.'});
      }
      if (request.method === 'GET' && requestPath === '/api/approvals') return json(response,200,{ok:true,approvals:await executionLayer.approvals(requestUrl.searchParams.get('status') || 'pending')});
      const approvalDecision = requestPath.match(/^\/api\/approvals\/([0-9a-f-]+)\/decision$/i);
      if (request.method === 'POST' && approvalDecision) {
        const body = await readBody(request);
        const result = await executionLayer.decideApproval(approvalDecision[1],body.decision,'api',body.note || '');
        return result ? json(response,200,{ok:true,...result}) : json(response,404,{ok:false,error:'Pending approval not found.'});
      }
      if (request.method === 'GET' && requestPath === '/api/audit') return json(response,200,{ok:true,audit:await executionLayer.audit(requestUrl.searchParams.get('task_id'))});
      if (request.method === 'GET' && requestPath === '/api/artifacts') return json(response,200,{ok:true,artifacts:await executionLayer.artifacts(requestUrl.searchParams.get('task_id'))});
      const artifactMatch = requestPath.match(/^\/api\/artifacts\/([0-9a-f-]+)$/i);
      if (request.method === 'GET' && artifactMatch) {
        const artifact = await executionLayer.artifact(artifactMatch[1]);
        return artifact ? json(response,200,{ok:true,artifact}) : json(response,404,{ok:false,error:'Artifact not found.'});
      }
      return json(response,405,{ok:false,error:'Method not allowed.'});
    }
    if (request.method === 'GET' && requestPath === '/api/access') {
      return json(response, 200, {required:Boolean(accessPin), mode:accessPin ? 'private-lan' : 'local-computer'});
    }
    if (requestPath.startsWith('/api/') && !hasApiAccess(request)) {
      return json(response, 401, {error:'Enter the six-digit Wilkerson access PIN shown on the host computer.'});
    }
    if (request.method === 'OPTIONS') {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) return json(response, 403, {error:'Origin not allowed.'});
      response.writeHead(204, {'Access-Control-Allow-Methods':'GET, POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, Authorization, MCP-Protocol-Version', 'Access-Control-Max-Age':'600'});
      return response.end();
    }
    if (request.method === 'GET' && request.url === '/api/llm/status') return json(response, 200, await ollamaTags());
    if (request.method === 'POST' && request.url === '/api/tts') {
      if (!rateLimit(request)) return json(response, 429, {error:'Rate limit reached. Wait one minute.'});
      const body = await readBody(request);
      return json(response, 200, {ok:true, audioUrl:await synthesize(body.text), engine:'Windows System.Speech', generatedAt:new Date().toISOString()});
    }
    if (request.method === 'POST' && request.url === '/api/stt') {
      if (!rateLimit(request)) return json(response, 429, {error:'Rate limit reached. Wait one minute.'});
      const body = await readBody(request);
      return json(response, 200, {ok:true, result:await recognizeSpeech(body.audio), generatedAt:new Date().toISOString()});
    }
    if (request.method === 'POST' && request.url === '/api/inspect') {
      if (!rateLimit(request)) return json(response, 429, {error:'Rate limit reached. Wait one minute.'});
      const body = await readBody(request);
      if (!['context', 'qa'].includes(body.mode)) return json(response, 400, {error:'Choose Context Engine or Browser Pilot mode.'});
      return json(response, 200, {ok:true, mode:body.mode, result:await inspect(body.url, body.mode)});
    }
    if (request.method === 'POST' && request.url === '/api/crawl') {
      if (!rateLimit(request)) return json(response, 429, {error:'Rate limit reached. Wait one minute.'});
      const body = await readBody(request);
      return json(response, 200, {ok:true, result:await crawlSite(body.url, body.maxPages, body.maxDepth)});
    }
    if (request.method === 'POST' && request.url === '/api/forge') {
      if (!rateLimit(request)) return json(response, 429, {error:'Rate limit reached. Wait one minute.'});
      return json(response, 200, {ok:true, result:await buildWithForge(await readBody(request))});
    }
    if (request.method === 'POST' && request.url === '/api/persona/chat') {
      if (!rateLimit(request)) return json(response, 429, {error:'Rate limit reached. Wait one minute.'});
      return json(response, 200, {ok:true, result:await personaChat(await readBody(request))});
    }
    if (request.method === 'POST' && request.url === '/api/persona/vision') {
      if (!rateLimit(request)) return json(response, 429, {error:'Rate limit reached. Wait one minute.'});
      return json(response, 200, {ok:true, result:await personaVision(await readBody(request))});
    }
    if (request.method === 'GET' && request.url === '/api/sovereign/state') {
      const state = await readSovereignState();
      return json(response, 200, {ok:true, provider:state.provider, killed:state.killed, workspaces:state.workspaces, tasks:state.tasks});
    }
    if (request.method === 'POST' && request.url === '/api/sovereign/workspaces') {
      const body = await readBody(request);
      const state = await readSovereignState();
      const workspace = {id:`wc-${randomUUID().slice(0, 8)}`, name:String(body.name || 'Founder Workspace').trim().slice(0, 80), template:String(body.template || 'governed-linux-desktop').slice(0, 80), status:state.killed ? 'paused' : 'ready', tasks:0, createdAt:new Date().toISOString()};
      state.workspaces.unshift(workspace);
      state.audit.unshift({at:new Date().toISOString(), event:'workspace.created', target:workspace.id});
      await writeSovereignState(state);
      return json(response, 201, {ok:true, workspace});
    }
    if (request.method === 'POST' && request.url === '/api/sovereign/tasks') {
      const body = await readBody(request);
      const command = String(body.command || '').trim().slice(0, 3000);
      const authority = ['readonly','supervised','trusted'].includes(body.authority) ? body.authority : 'supervised';
      if (!command) return json(response, 400, {error:'Tell WISDOM what you want accomplished.'});
      const state = await readSovereignState();
      if (state.killed) return json(response, 423, {error:'The Sovereign kill switch is active. Restart the service to begin a new controlled session.'});
      let workspace = state.workspaces.find(item => item.status === 'ready');
      if (!workspace) {
        workspace = {id:`wc-${randomUUID().slice(0, 8)}`, name:'WISDOM Primary Workspace', template:'governed-linux-desktop', status:'ready', tasks:0, createdAt:new Date().toISOString()};
        state.workspaces.unshift(workspace);
      }
      const approval = requiresApproval(command, authority);
      const task = {id:`task-${randomUUID().slice(0, 8)}`, workspaceId:workspace.id, command, authority, status:approval ? 'approval-required' : 'planned', createdAt:new Date().toISOString(), plan:taskPlan(command), summary:approval ? 'I prepared the task and paused before the consequential action. Your confirmation is required.' : 'I translated your command into a governed, auditable workspace plan.', boundary:state.provider === 'local-demo' ? 'Planned locally. No external account or cloud computer was changed.' : 'Provider execution remains subject to configured credentials and policy.'};
      workspace.tasks += 1;
      state.tasks.unshift(task);
      state.tasks = state.tasks.slice(0, 100);
      state.audit.unshift({at:task.createdAt, event:'task.created', target:task.id, status:task.status});
      await writeSovereignState(state);
      return json(response, 201, {ok:true, task});
    }
    if (request.method === 'POST' && request.url === '/api/sovereign/kill') {
      const body = await readBody(request);
      if (body.confirmed !== true) return json(response, 400, {error:'Explicit confirmation is required.'});
      const state = await readSovereignState();
      state.killed = true;
      state.workspaces = state.workspaces.map(item => ({...item, status:'paused'}));
      state.tasks = state.tasks.map(item => ['planned','running'].includes(item.status) ? {...item, status:'cancelled'} : item);
      state.audit.unshift({at:new Date().toISOString(), event:'kill-switch.activated', target:'all'});
      await writeSovereignState(state);
      return json(response, 200, {ok:true, killed:true});
    }
    if (request.method === 'GET') return serveStatic(request, response);
    json(response, 405, {error:'Method not allowed.'});
  } catch (error) {
    json(response, 400, {ok:false, error:error.name === 'AbortError' ? 'The request timed out.' : error.message || 'Request failed.'});
  }
});

server.listen(port, bindAddress, () => console.log(`Wilkerson Tool Suite: http://${bindAddress}:${port}${accessPin ? ' (PIN protected)' : ''}`));

async function shutdown(signal) {
  console.log(`${signal} received; draining execution layer.`);
  server.close(async () => {
    if (executionLayer) await executionLayer.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
