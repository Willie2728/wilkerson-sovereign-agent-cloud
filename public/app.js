const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let currentMode = 'sovereign';
let lastResult = null;
let cameraStream = null;
let visualContext = '';
let dictationState = null;
let deferredInstallPrompt = null;

const modes = {
  sovereign: ['AGENT COMPUTER CONTROL PLANE', 'Wilkerson Sovereign Agent Cloud', 'Operate governed agent workspaces through WISDOM. Planning, approvals, audit, and the kill switch work now; actual cloud computers require the Orgo adapter and credentials.', 'PATTERNED AFTER: ORGO · PARTIAL'],
  forge: ['LOCAL APP GENERATION', 'Wilkerson Forge AI', 'Describe a focused web experience and receive a standalone page you can preview and download. This is not a Base44 database, authentication, hosting, or backend replacement.', 'PATTERNED AFTER: BASE44 · FOCUSED EQUIVALENT'],
  persona: ['TEXT · VOICE · SNAPSHOT VISION', 'Wilkerson Persona Live', 'Talk with WISDOM, hear the answer, and optionally share one user-approved camera snapshot for visible-scene context.', 'WILKERSON ORIGINAL MODULE'],
  crawl: ['BOUNDED PUBLIC-WEB CRAWLING', 'Wilkerson Context Crawler', 'Crawl up to eight public pages on one website while respecting robots rules and blocking private-network targets.', 'PATTERNED AFTER: FIRECRAWL CRAWL · BOUNDED'],
  context: ['PUBLIC PAGE EXTRACTION', 'Wilkerson Context Engine', 'Extract readable content, headings, links, title, and description from one public page.', 'PATTERNED AFTER: FIRECRAWL SCRAPE · BOUNDED'],
  qa: ['HTTP + ACCESSIBILITY REVIEW', 'Wilkerson Browser Pilot', 'Run a fast public-page check for titles, language, viewport, headings, and image alt text.', 'WILKERSON ORIGINAL MODULE'],
  voice: ['PRIVATE SPEECH', 'Wilkerson Voice Engine', 'Create downloadable Windows WAV speech locally, with browser speech as a hosted fallback.', 'WILKERSON ORIGINAL MODULE'],
  rooms: ['LOCAL WEBRTC DEVICES', 'Wilkerson Rooms', 'Start a private local camera and microphone preview. It does not create a multi-participant Daily room until a provider adapter is configured.', 'PATTERNED AFTER: DAILY.CO · DEVICE FOUNDATION'],
  motion: ['MEDIA PREVIS WORKBENCH', 'Wilkerson MotionLab', 'Preview a local image or video with cinematic motion and export a production storyboard. It is not an Unreal Engine real-time 3D editor.', 'PATTERNED AFTER: UNREAL ENGINE WORKFLOWS · PREVIS ONLY'],
  broadcast: ['MULTI-CHANNEL DRAFTING', 'Wilkerson Broadcast Studio', 'Turn one brief into organized draft copy. Nothing is posted automatically.', 'WILKERSON ORIGINAL MODULE'],
  skills: ['AUDITED CAPABILITIES', 'Wilkerson Skill Exchange', 'Create portable skill manifests with explicit permissions, inputs, and outputs.', 'WILKERSON ORIGINAL MODULE'],
  agent: ['GUARDRAILED ORCHESTRATION', 'Wilkerson Agent Core', 'Build an auditable workflow with approval gates; it does not silently perform external actions.', 'WILKERSON ORIGINAL MODULE']
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

function toolIntro(mode) {
  const [kicker, title, copy, source] = modes[mode];
  return `<div class="tool-intro"><span class="eyebrow">${kicker}</span><h2>${title}</h2><span class="source-chip">${source}</span><p>${copy}</p></div>`;
}

function setMode(mode) {
  if (!modes[mode]) return;
  stopCamera();
  cancelDictation();
  currentMode = mode;
  $$('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
  $('#result').innerHTML = '';
  const panel = $('#panel');
  if (mode === 'sovereign') {
    panel.innerHTML = `${toolIntro(mode)}<div class="sovereign-shell"><aside class="wisdom-console"><div class="sovereign-avatar"><img src="willie-approved-headshot.png" alt="WISDOM conversational avatar"><span class="avatar-orbit"></span><b>WISDOM</b><small>FOUNDER COMMAND GUIDE</small></div><div class="permission-meter"><span>Authority mode</span><b id="authorityLabel">Supervised</b><select id="authorityMode"><option value="supervised">Supervised · confirm consequential actions</option><option value="readonly">Read only · research and inspect</option><option value="trusted">Trusted local · routine local actions</option></select></div></aside><section class="command-deck"><div class="command-status"><span><i></i> LOCAL CONTROL PLANE</span><span id="providerState">PROVIDER: LOCAL DEMO</span></div><form id="sovereignForm"><label for="sovereignPrompt">Tell WISDOM what to accomplish</label><textarea id="sovereignPrompt" maxlength="3000" required placeholder="Create a research workspace, inspect a public website, and save a brief…"></textarea><div class="command-actions"><button type="button" class="voice-command" id="sovereignMic">🎙 Speak command</button><button type="submit">Launch task</button></div><small id="sovereignVoiceStatus">Voice is local. Commands create an auditable task before execution.</small></form><div class="workspace-toolbar"><button id="newWorkspace" type="button">+ New workspace</button><button id="refreshSovereign" type="button">Refresh</button><button id="killAll" type="button" class="danger-action">Kill switch</button></div><div id="sovereignState" class="sovereign-state"><p>Loading governed workspaces…</p></div></section></div>`;
    $('#sovereignForm').onsubmit = launchSovereignTask;
    $('#sovereignMic').onclick = startSovereignDictation;
    $('#newWorkspace').onclick = createSovereignWorkspace;
    $('#refreshSovereign').onclick = loadSovereignState;
    $('#killAll').onclick = activateKillSwitch;
    $('#authorityMode').onchange = event => { $('#authorityLabel').textContent = event.target.options[event.target.selectedIndex].text.split(' · ')[0]; };
    loadSovereignState();
  } else if (mode === 'forge') {
    panel.innerHTML = `${toolIntro(mode)}<form id="forgeForm"><label for="forgePrompt">What should the page do?</label><textarea id="forgePrompt" required>Build a cinematic luxury university welcome page with a moving campus atmosphere, three interactive programs, and a working guided-tour button.</textarea><div class="input-row"><input id="forgeName" value="Wilkerson University Experience" aria-label="Project name"><button>Generate locally</button></div><small>First generation can take 1–5 minutes on this laptop. Best for focused standalone pages. Dyad is also installed for multi-file local projects.</small></form>`;
    $('#forgeForm').onsubmit = buildPage;
  } else if (mode === 'persona') {
    panel.innerHTML = `${toolIntro(mode)}<div class="persona-builder"><div class="portrait-shell" id="portraitShell"><img src="willie-approved-headshot.png" alt="Approved portrait of Willie Wilkerson"><span class="consent-badge">APPROVED PORTRAIT</span></div><form id="personaForm"><label for="personaText">Talk with WISDOM</label><textarea id="personaText" maxlength="2000" required placeholder="What can this local AI studio help me accomplish today?" aria-describedby="dictationStatus"></textarea><div class="dictation-controls"><button type="button" class="secondary-action microphone-action" id="startDictation" aria-label="Start microphone dictation">🎙 Dictate</button><button type="button" class="secondary-action" id="stopDictation" disabled>Stop</button><button type="button" class="secondary-action" id="clearPersona">Clear text</button></div><small id="dictationStatus" class="dictation-status">Type freely, or select Dictate and speak for up to 15 seconds. Audio is recognized locally.</small><div class="action-row"><button>Ask and hear answer</button><button type="button" class="secondary-action" id="startCamera">Start camera</button></div><button type="button" class="secondary-action" id="describeSnapshot" disabled>Share one snapshot with local vision</button><small id="cameraNotice">Camera remains off until you start it. Snapshot analysis is local and user-initiated.</small></form></div><div class="camera-stage" id="cameraStage" hidden><video id="cameraVideo" autoplay muted playsinline></video><button type="button" class="secondary-action" id="stopCamera">Stop camera</button></div>`;
    $('#personaForm').onsubmit = chatWithPersona;
    $('#startDictation').onclick = startDictation;
    $('#stopDictation').onclick = () => stopDictation(false);
    $('#clearPersona').onclick = () => { $('#personaText').value = ''; $('#personaText').focus(); $('#dictationStatus').textContent = 'Text cleared. Type or select Dictate to begin.'; };
    $('#startCamera').onclick = startCamera;
    $('#stopCamera').onclick = stopCamera;
    $('#describeSnapshot').onclick = describeSnapshot;
  } else if (mode === 'crawl') {
    panel.innerHTML = `${toolIntro(mode)}<form id="crawlForm"><label for="crawlUrl">Website name or address</label><input id="crawlUrl" type="text" inputmode="url" autocomplete="url" required placeholder="youtube or youtube.com"><small class="input-help">You do not need to type https:// — it will be added automatically.</small><div class="input-row"><select id="crawlPages"><option value="3">Up to 3 pages</option><option value="5">Up to 5 pages</option><option value="8">Up to 8 pages</option></select><select id="crawlDepth" aria-label="Crawl depth"><option value="1">Depth 1</option><option value="2">Depth 2</option></select><button>Crawl website</button></div><small>Same-origin only · robots-aware · no login, CAPTCHA, paywall, or anti-bot bypass</small></form>`;
    $('#crawlForm').onsubmit = crawlSite;
  } else if (mode === 'context' || mode === 'qa') {
    panel.innerHTML = `${toolIntro(mode)}<form id="inspectForm"><label for="url">Public webpage URL</label><div class="input-row"><input id="url" type="url" required placeholder="https://example.com/"><button>Inspect page</button></div><small>Private-network targets blocked · 1.5 MB limit · 12-second timeout</small></form>`;
    $('#inspectForm').onsubmit = inspectPage;
  } else if (mode === 'voice') {
    panel.innerHTML = `${toolIntro(mode)}<form id="voiceForm"><label for="voiceText">Words to speak</label><textarea id="voiceText" maxlength="2000" required>Welcome to Wilkerson Collective University, where knowledge becomes legacy.</textarea><button>Generate voice</button><small>Private on this PC · maximum 2,000 characters</small></form>`;
    $('#voiceForm').onsubmit = event => generateSpeech(event, $('#voiceText').value);
  } else if (mode === 'rooms') {
    panel.innerHTML = `${toolIntro(mode)}<div class="room-builder"><div><p class="boundary"><b>Working now:</b> camera, microphone, mute, and local preview on this device.</p><p><b>Next server stage:</b> authenticated HTTPS rooms and multi-device signaling through a self-hosted WebRTC server.</p></div><div><button id="startRoom">Start private device studio</button><button id="stopRoom" class="secondary-action" disabled>Stop</button></div></div>`;
    $('#startRoom').onclick = startRoom;
    $('#stopRoom').onclick = stopCamera;
  } else if (mode === 'motion') {
    panel.innerHTML = `${toolIntro(mode)}<form id="motionForm"><label for="mediaFile">Local image or video</label><input class="file-input" id="mediaFile" type="file" accept="image/*,video/*" required><div class="input-row"><select id="motionStyle"><option>Cinematic campus reveal</option><option>Elegant portrait push-in</option><option>Performance spotlight</option><option>Lecture hall documentary</option></select><button>Preview + storyboard</button></div><small>Your media stays in this browser. This is motion treatment and planning, not generated video.</small></form>`;
    $('#motionForm').onsubmit = buildStoryboard;
  } else if (mode === 'broadcast') {
    panel.innerHTML = `${toolIntro(mode)}<form id="broadcastForm"><label for="broadcastBrief">Source brief</label><textarea id="broadcastBrief" required>Wilkerson Collective University connects knowledge, creativity, technology, and legacy.</textarea><div class="input-row"><select id="broadcastTone"><option>Founder visionary</option><option>Executive concise</option><option>Warm educational</option></select><button>Create drafts</button></div></form>`;
    $('#broadcastForm').onsubmit = buildBroadcast;
  } else if (mode === 'skills') {
    panel.innerHTML = `${toolIntro(mode)}<form id="skillForm"><label for="skillName">Skill name</label><input id="skillName" value="University Experience Reviewer" required><label for="skillPurpose">Purpose</label><textarea id="skillPurpose" required>Review a local experience for motion, audio, accessibility, and dead controls.</textarea><div class="input-row"><select id="skillPermission"><option>Read-only</option><option>Local file write</option><option>Public web access</option></select><button>Create manifest</button></div></form>`;
    $('#skillForm').onsubmit = buildSkill;
  } else {
    panel.innerHTML = `${toolIntro(mode)}<form id="agentForm"><label for="agentGoal">Workflow goal</label><textarea id="agentGoal" required>Research a public topic, draft a founder brief, run quality checks, and wait for approval before export.</textarea><div class="input-row"><select id="agentGate"><option>Approval before every external action</option><option>Approval before final export</option><option>Read-only dry run</option></select><button>Build workflow</button></div></form>`;
    $('#agentForm').onsubmit = buildWorkflow;
  }
}

async function api(path, body) {
  const response = await fetch(path, {method:'POST', headers:authHeaders({'Content-Type':'application/json'}), body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The local service could not complete the request.');
  return data;
}

async function getApi(path) {
  const response = await fetch(path, {headers:authHeaders()});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The local service could not complete the request.');
  return data;
}

async function loadSovereignState() {
  try {
    const data = await getApi('/api/sovereign/state');
    $('#providerState').textContent = `PROVIDER: ${data.provider.toUpperCase()}`;
    const workspaces = data.workspaces.map(item => `<article class="workspace-row"><div><span class="workspace-dot ${escapeHtml(item.status)}"></span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.id)} · ${escapeHtml(item.status)}</small></div><div class="workspace-meta"><span>${escapeHtml(item.template)}</span><span>${item.tasks} tasks</span></div></article>`).join('') || '<p>No workspaces yet. Create your first governed computer.</p>';
    const tasks = data.tasks.slice(0, 6).map(item => `<article class="task-row"><span class="task-state ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span><div><b>${escapeHtml(item.command)}</b><small>${new Date(item.createdAt).toLocaleString()} · ${escapeHtml(item.authority)}</small></div></article>`).join('') || '<p>No task history yet.</p>';
    $('#sovereignState').innerHTML = `<div class="state-grid"><section><span class="eyebrow">AGENT COMPUTERS</span>${workspaces}</section><section><span class="eyebrow">AUDIT STREAM</span>${tasks}</section></div><p class="boundary"><b>Capability truth:</b> local control, voice intake, workspace records, task planning, permission gates, audit history, and kill switch work now. A real isolated cloud desktop requires a configured provider adapter; no cloud VM is claimed in local-demo mode.</p>`;
  } catch (error) { showError(error); }
}

async function createSovereignWorkspace() {
  try {
    await api('/api/sovereign/workspaces', {name:`Founder Workspace ${new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`, template:'governed-linux-desktop'});
    await loadSovereignState();
  } catch (error) { showError(error); }
}

async function launchSovereignTask(event) {
  event.preventDefault();
  const button = event.submitter;
  busy(button, true, 'Planning…');
  try {
    const command = $('#sovereignPrompt').value.trim();
    const data = await api('/api/sovereign/tasks', {command, authority:$('#authorityMode').value});
    $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">WISDOM TASK RECEIPT</span><h2>${escapeHtml(data.task.status === 'approval-required' ? 'Approval required' : 'Task accepted')}</h2><p>${escapeHtml(data.task.summary)}</p><ol>${data.task.plan.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol><p class="boundary">${escapeHtml(data.task.boundary)}</p></article>`;
    await loadSovereignState();
    speakAnswer(data.task.summary).catch(() => {});
  } catch (error) { showError(error); }
  finally { busy(button, false, 'Launch task'); }
}

function startSovereignDictation() {
  const originalMode = currentMode;
  startDictationFor('#sovereignPrompt', '#sovereignVoiceStatus', '#sovereignMic').catch(showError);
}

async function startDictationFor(inputSelector, statusSelector, buttonSelector) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) throw new Error('Live browser speech recognition is unavailable here. Use Persona Live dictation for private Windows recognition.');
  const recognition = new Recognition();
  recognition.lang = 'en-US'; recognition.interimResults = false; recognition.continuous = false;
  $(statusSelector).textContent = 'Listening… speak your task.'; $(buttonSelector).classList.add('is-listening');
  recognition.onresult = event => { $(inputSelector).value = event.results[0][0].transcript; $(statusSelector).textContent = 'Command captured. Review it, then launch.'; };
  recognition.onerror = event => { $(statusSelector).textContent = `Voice input stopped: ${event.error}`; };
  recognition.onend = () => $(buttonSelector)?.classList.remove('is-listening');
  recognition.start();
}

async function activateKillSwitch() {
  if (!confirm('Pause every active Sovereign task and workspace now?')) return;
  try { await api('/api/sovereign/kill', {confirmed:true}); await loadSovereignState(); }
  catch (error) { showError(error); }
}

async function refreshLocalStatus() {
  const node = $('#localStatus');
  try {
    const response = await fetch('/api/llm/status', {headers:authHeaders()});
    if (response.status === 401) { $('#accessDialog')?.showModal(); throw new Error('PIN required'); }
    const data = await response.json();
    const ready = data.online && data.codingReady && data.visionReady;
    node.classList.toggle('offline', !ready);
    node.querySelector('span').textContent = ready ? 'Local AI ready · code + vision' : data.online ? 'Local AI partial' : 'Local AI offline';
  } catch {
    node.classList.add('offline');
    node.querySelector('span').textContent = 'Local AI offline';
  }
}

function authHeaders(extra = {}) {
  const pin = localStorage.getItem('wilkersonAccessPin');
  return pin ? {...extra, 'X-Wilkerson-Pin':pin} : extra;
}

async function setupAccess() {
  try {
    const response = await fetch('/api/access');
    const access = await response.json();
    if (!access.required) return true;
    const check = await fetch('/api/llm/status', {headers:authHeaders()});
    if (check.ok) return true;
    $('#accessDialog').showModal();
    return false;
  } catch {
    return false;
  }
}

async function submitAccess(event) {
  event.preventDefault();
  const pin = $('#accessPin').value.trim();
  $('#accessMessage').textContent = 'Checking PIN…';
  localStorage.setItem('wilkersonAccessPin', pin);
  const response = await fetch('/api/llm/status', {headers:authHeaders()});
  if (!response.ok) {
    localStorage.removeItem('wilkersonAccessPin');
    $('#accessMessage').textContent = 'That PIN was not accepted. Check the host computer and try again.';
    return;
  }
  $('#accessMessage').textContent = 'Connected.';
  $('#accessDialog').close();
  refreshLocalStatus();
}

function showInstallHelp() {
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isFireTv = /AFT|Silk/i.test(navigator.userAgent) || document.body.classList.contains('tv-mode');
  const message = isAppleMobile
    ? 'In Safari, select Share, then Add to Home Screen.'
    : isFireTv
      ? 'On Fire TV, open this address in Silk and save it as a bookmark. The TV layout is already active.'
      : 'Open the browser menu and choose Install app or Add to Home screen.';
  $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">INSTALL WILKERSON AI</span><h2>Add this app to your device</h2><p>${escapeHtml(message)}</p><p class="boundary">The computer running Wilkerson AI must remain powered on and connected to the same network.</p></article>`;
  window.scrollTo({top:$('#result').offsetTop - 30, behavior:'smooth'});
}

function setupInstallAndTv() {
  const installButton = $('#installApp');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isAppleMobile && !standalone) installButton.hidden = false;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });
  installButton.onclick = async () => {
    if (!deferredInstallPrompt) return showInstallHelp();
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  };
  const detectedTv = /AFT|Silk/i.test(navigator.userAgent) || new URLSearchParams(location.search).get('tv') === '1';
  document.body.classList.toggle('tv-mode', detectedTv);
  $('#tvMode').textContent = detectedTv ? 'Exit TV mode' : 'TV mode';
  $('#tvMode').onclick = () => {
    const enabled = document.body.classList.toggle('tv-mode');
    $('#tvMode').textContent = enabled ? 'Exit TV mode' : 'TV mode';
  };
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('tv-mode') || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    const items = [...document.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')].filter(item => item.offsetParent !== null);
    if (!items.length) return;
    const current = Math.max(0, items.indexOf(document.activeElement));
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -3 : 3;
    items[(current + step + items.length) % items.length].focus();
    event.preventDefault();
  });
  document.addEventListener('pause', () => document.querySelectorAll('audio,video').forEach(media => media.pause()));
  document.addEventListener('visibilitychange', () => { if (document.hidden) document.querySelectorAll('audio,video').forEach(media => media.pause()); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

async function buildPage(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  busy(button, true, 'Generating…');
  $('#result').innerHTML = '<div class="result-card"><b>Local model is building your page.</b><p>This laptop runs one model at a time. Allow up to five minutes.</p></div>';
  try {
    const data = await api('/api/forge', {prompt:$('#forgePrompt').value, name:$('#forgeName').value});
    lastResult = data.result;
    const src = URL.createObjectURL(new Blob([lastResult.html], {type:'text/html'}));
    $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">LOCAL BUILD COMPLETE</span><h2>${escapeHtml($('#forgeName').value)}</h2><div class="model-status">${escapeHtml(lastResult.model)} · ${(lastResult.elapsedMs / 1000).toFixed(1)} seconds</div><iframe class="forge-preview" sandbox="allow-scripts" src="${src}" title="Generated page preview"></iframe><p class="boundary">${escapeHtml(lastResult.boundary)}</p><button class="download" id="downloadPage">Download standalone HTML</button></article>`;
    $('#downloadPage').onclick = () => downloadFile(`${slug($('#forgeName').value)}.html`, lastResult.html, 'text/html');
  } catch (error) { showError(error); }
  finally { busy(button, false, 'Generate locally'); }
}

async function chatWithPersona(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const message = $('#personaText').value;
  busy(button, true, 'Thinking locally…');
  $('#result').innerHTML = `<article class="result-card"><div class="chat-bubble user">${escapeHtml(message)}</div><div class="chat-bubble assistant">WISDOM is thinking…</div></article>`;
  try {
    const data = await api('/api/persona/chat', {message, visualContext});
    const answer = data.result.text;
    $('#result').innerHTML = `<article class="result-card voice-result"><div class="speaking-portrait" id="speakingPortrait"><img src="willie-approved-headshot.png" alt="Approved Willie portrait"><div class="voice-rings"></div></div><div><span class="eyebrow">WISDOM · LOCAL MODEL</span><div class="chat-bubble user">${escapeHtml(message)}</div><div class="chat-bubble assistant">${escapeHtml(answer)}</div><div id="audioSlot"><button class="secondary-action" id="hearAnswer">Hear answer</button></div><small>${escapeHtml(data.result.model)} · ${(data.result.elapsedMs / 1000).toFixed(1)} seconds</small></div></article>`;
    $('#hearAnswer').onclick = () => speakAnswer(answer);
    speakAnswer(answer);
  } catch (error) { showError(error); }
  finally { busy(button, false, 'Ask and hear answer'); }
}

async function speakAnswer(text) {
  const slot = $('#audioSlot');
  if (slot) slot.innerHTML = '<small>Creating local speech…</small>';
  try {
    const data = await api('/api/tts', {text});
    if (!slot) return;
    slot.innerHTML = `<audio id="generatedAudio" controls autoplay src="${data.audioUrl}"></audio><p><a class="download link-button" href="${data.audioUrl}" download="wilkerson-wisdom.wav">Download WAV</a></p>`;
    animateAudio($('#generatedAudio'));
    $('#generatedAudio').play().catch(() => {});
  } catch (error) {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      if (slot) slot.innerHTML = '<small>Speaking with this browser because downloadable Windows WAV speech is unavailable on this host.</small>';
    } else if (slot) slot.innerHTML = `<small>${escapeHtml(error.message)}</small>`;
  }
}

async function startDictation() {
  if (dictationState) return;
  const status = $('#dictationStatus');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser.');
    const stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true, noiseSuppression:true, autoGainControl:true}, video:false});
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Audio recording is unavailable in this browser.');
    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(context.destination);
    const timer = setTimeout(() => stopDictation(false), 15000);
    dictationState = {stream, context, source, processor, chunks, sampleRate:context.sampleRate, timer};
    $('#startDictation').disabled = true;
    $('#stopDictation').disabled = false;
    $('#startDictation').classList.add('is-listening');
    status.textContent = 'Listening now… Speak clearly, then select Stop.';
  } catch (error) {
    cancelDictation();
    status.textContent = `Microphone could not start: ${error.message}`;
    showError(error);
  }
}

async function stopDictation(cancelled = false) {
  const state = dictationState;
  if (!state) return;
  dictationState = null;
  clearTimeout(state.timer);
  state.processor.disconnect();
  state.source.disconnect();
  state.stream.getTracks().forEach(track => track.stop());
  await state.context.close();
  const start = $('#startDictation');
  const stop = $('#stopDictation');
  if (start) { start.disabled = false; start.classList.remove('is-listening'); }
  if (stop) stop.disabled = true;
  if (cancelled) return;
  const status = $('#dictationStatus');
  if (!state.chunks.length) { status.textContent = 'No audio was captured. Try Dictate again.'; return; }
  status.textContent = 'Transcribing locally…';
  try {
    const wav = encodeWav(state.chunks, state.sampleRate, 16000);
    const audio = await blobToDataUrl(wav);
    const data = await api('/api/stt', {audio});
    const box = $('#personaText');
    box.value = data.result.text;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
    status.textContent = `Dictation inserted · ${data.result.engine} · American English`;
  } catch (error) {
    status.textContent = error.message;
    showError(error);
  }
}

function cancelDictation() {
  if (!dictationState) return;
  const state = dictationState;
  dictationState = null;
  clearTimeout(state.timer);
  try { state.processor.disconnect(); state.source.disconnect(); } catch {}
  state.stream.getTracks().forEach(track => track.stop());
  state.context.close().catch(() => {});
}

function encodeWav(chunks, inputRate, outputRate) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let index = 0; index < outputLength; index++) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex++) sum += input[sourceIndex];
    output[index] = sum / Math.max(1, end - start);
  }
  const buffer = new ArrayBuffer(44 + output.length * 2);
  const view = new DataView(buffer);
  const write = (position, value) => [...value].forEach((character, index) => view.setUint8(position + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + output.length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, outputRate, true);
  view.setUint32(28, outputRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, output.length * 2, true);
  output.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
  return new Blob([buffer], {type:'audio/wav'});
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function startCamera() {
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{width:{ideal:960}}, audio:false});
    $('#cameraStage').hidden = false;
    $('#cameraVideo').srcObject = cameraStream;
    $('#describeSnapshot').disabled = false;
    $('#startCamera').textContent = 'Restart camera';
  } catch (error) { showError(new Error(`Camera unavailable: ${error.message}`)); }
}

async function describeSnapshot() {
  const video = $('#cameraVideo');
  if (!cameraStream || !video.videoWidth) return showError(new Error('Start the camera and wait for the picture first.'));
  const button = $('#describeSnapshot');
  busy(button, true, 'Analyzing locally…');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, 720 / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    const data = await api('/api/persona/vision', {image:canvas.toDataURL('image/jpeg', .72), prompt:'Describe only useful visible scene context for our next conversation.'});
    visualContext = data.result.text;
    $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">USER-APPROVED SNAPSHOT</span><h2>Local vision observation</h2><p>${escapeHtml(visualContext)}</p><small>${escapeHtml(data.result.model)} · ${(data.result.elapsedMs / 1000).toFixed(1)} seconds. This context will be included with your next question.</small></article>`;
  } catch (error) { showError(error); }
  finally { busy(button, false, 'Share one snapshot with local vision'); }
}

async function startRoom() {
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">PRIVATE DEVICE STUDIO ACTIVE</span><h2>Your camera and microphone are connected locally</h2><video class="room-video" id="roomVideo" autoplay muted playsinline></video><div class="action-row"><button class="secondary-action" id="muteRoom">Mute microphone</button><button class="secondary-action" id="cameraRoom">Turn camera off</button></div><p class="boundary">No stream is sent to a server. This proves local device access only; it is not yet a multi-device call.</p></article>`;
    $('#roomVideo').srcObject = cameraStream;
    $('#startRoom').disabled = true;
    $('#stopRoom').disabled = false;
    $('#muteRoom').onclick = () => toggleTrack('audio', $('#muteRoom'), 'Mute microphone', 'Unmute microphone');
    $('#cameraRoom').onclick = () => toggleTrack('video', $('#cameraRoom'), 'Turn camera off', 'Turn camera on');
  } catch (error) { showError(new Error(`Camera or microphone unavailable: ${error.message}`)); }
}

function toggleTrack(kind, button, onLabel, offLabel) {
  const track = cameraStream?.getTracks().find(item => item.kind === kind);
  if (!track) return;
  track.enabled = !track.enabled;
  button.textContent = track.enabled ? onLabel : offLabel;
}

function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const stage = $('#cameraStage'); if (stage) stage.hidden = true;
  const start = $('#startRoom'); if (start) start.disabled = false;
  const stop = $('#stopRoom'); if (stop) stop.disabled = true;
  const resultVideo = $('#roomVideo'); if (resultVideo) resultVideo.srcObject = null;
}

async function crawlSite(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  busy(button, true, 'Crawling…');
  $('#result').innerHTML = '<div class="result-card">Reading permitted same-site public pages…</div>';
  try {
    const data = await api('/api/crawl', {url:$('#crawlUrl').value, maxPages:Number($('#crawlPages').value), maxDepth:Number($('#crawlDepth').value)});
    lastResult = data.result;
    const cards = lastResult.pages.map(page => `<section><b>${escapeHtml(page.title || 'Untitled')}</b><small>${escapeHtml(page.url)}</small><p>${escapeHtml((page.description || page.text || '').slice(0, 260))}</p><a class="page-link" href="${escapeHtml(page.url)}" target="_blank" rel="noopener">Open this page ↗</a></section>`).join('');
    const warnings = lastResult.errors.length ? `<details class="crawl-warnings"><summary>${lastResult.errors.length} page${lastResult.errors.length === 1 ? '' : 's'} could not be read</summary>${lastResult.errors.map(item => `<p><b>${escapeHtml(item.url)}</b><br>${escapeHtml(item.error)}</p>`).join('')}</details>` : '';
    $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">WEBSITE RETURNED</span><h2>${lastResult.pages.length} public page${lastResult.pages.length === 1 ? '' : 's'} captured</h2><p><b>Requested:</b> ${escapeHtml(lastResult.requestedInput)}<br><b>Resolved address:</b> <a class="page-link" href="${escapeHtml(lastResult.startUrl)}" target="_blank" rel="noopener">${escapeHtml(lastResult.startUrl)} ↗</a></p><div class="meta"><span class="pill">${lastResult.elapsedMs} ms</span><span class="pill">depth ${lastResult.maxDepth}</span></div><div class="crawl-grid">${cards}</div>${warnings}<button class="download" id="downloadCrawl">Download JSON</button></article>`;
    $('#downloadCrawl').onclick = () => downloadFile('wilkerson-crawl.json', JSON.stringify(lastResult, null, 2), 'application/json');
  } catch (error) { showError(error); }
  finally { busy(button, false, 'Crawl website'); }
}

async function inspectPage(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  busy(button, true, 'Inspecting…');
  try {
    const data = await api('/api/inspect', {url:$('#url').value, mode:currentMode});
    lastResult = data.result;
    const checks = lastResult.checks ? `<div class="checks">${lastResult.checks.map(check => `<div class="check ${check.pass ? '' : 'fail'}"><b>${check.pass ? '✓' : '!'} ${escapeHtml(check.name)}</b><small>${escapeHtml(check.detail)}</small></div>`).join('')}</div>` : '';
    $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">INSPECTION COMPLETE</span><h2>${escapeHtml(lastResult.title || 'Untitled')}</h2><div class="meta"><span class="pill">HTTP ${lastResult.status}</span><span class="pill">${lastResult.elapsedMs} ms</span><span class="pill">${lastResult.links.length} links</span></div><p>${escapeHtml(lastResult.description || 'No description found.')}</p>${checks}<div class="extract">${escapeHtml(lastResult.text.slice(0, 5000))}</div><button class="download" id="downloadResult">Download JSON</button></article>`;
    $('#downloadResult').onclick = () => downloadFile('wilkerson-inspection.json', JSON.stringify(lastResult, null, 2), 'application/json');
  } catch (error) { showError(error); }
  finally { busy(button, false, 'Inspect page'); }
}

async function generateSpeech(event, text) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  busy(button, true, 'Creating voice…');
  try {
    const data = await api('/api/tts', {text});
    $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">VOICE READY</span><h2>Your local audio is ready</h2><audio id="generatedAudio" controls autoplay src="${data.audioUrl}"></audio><p><a class="download link-button" href="${data.audioUrl}" download="wilkerson-voice.wav">Download WAV</a></p><small>${escapeHtml(data.engine)}</small></article>`;
    $('#generatedAudio').play().catch(() => {});
  } catch (error) {
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">BROWSER VOICE ACTIVE</span><h2>Speech is playing</h2><p>The hosted service cannot create a Windows WAV file, so this device's browser voice is being used.</p><button class="secondary-action" id="repeatBrowserSpeech">Play again</button><p class="boundary">Playback works here; WAV download requires the local Windows launcher.</p></article>`;
      $('#repeatBrowserSpeech').onclick = () => { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); };
    } else showError(error);
  }
  finally { busy(button, false, 'Generate voice'); }
}

function buildStoryboard(event) {
  event.preventDefault();
  const file = $('#mediaFile').files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const media = file.type.startsWith('video/') ? `<video src="${url}" controls autoplay muted loop></video>` : `<img class="motion-image" src="${url}" alt="Local preview">`;
  const style = $('#motionStyle').value;
  $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">MOTION PREVIEW</span><h2>${escapeHtml(style)}</h2><div class="motion-preview ken-burns">${media}</div><div class="story-grid"><div><b>1 · Establish</b><p>Wide reveal, gentle light, environmental motion.</p></div><div><b>2 · Discover</b><p>Controlled push-in toward the human or architectural focus.</p></div><div><b>3 · Resolve</b><p>Hold on the key message and accessible action.</p></div></div><button class="download" id="downloadStory">Download storyboard</button><p class="boundary">Preview and storyboard only. No AI-generated frames were created.</p></article>`;
  $('#downloadStory').onclick = () => downloadFile('wilkerson-storyboard.txt', `${style}\n\n1. Establish: Wide reveal and environment.\n2. Discover: Controlled push-in.\n3. Resolve: Hold on key message and action.`, 'text/plain');
}

function buildBroadcast(event) {
  event.preventDefault();
  const brief = $('#broadcastBrief').value.trim();
  const tone = $('#broadcastTone').value;
  const drafts = {headline:`${brief.split(/[.!?]/)[0]}.`, social:`${brief}\n\nBuilt with purpose. Designed for legacy.`, video:`OPEN: A cinematic reveal.\nVOICE: ${brief}\nCLOSE: Discover what comes next.`};
  $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">DRAFT PACKAGE · ${escapeHtml(tone.toUpperCase())}</span><div class="copy-grid"><div><b>Headline</b><p>${escapeHtml(drafts.headline)}</p></div><div><b>Social</b><p>${escapeHtml(drafts.social)}</p></div><div><b>Video outline</b><p>${escapeHtml(drafts.video)}</p></div></div><button class="download" id="downloadDrafts">Download drafts</button><p class="boundary">Review required. Nothing was published.</p></article>`;
  $('#downloadDrafts').onclick = () => downloadFile('wilkerson-broadcast.txt', Object.values(drafts).join('\n\n---\n\n'), 'text/plain');
}

function buildSkill(event) {
  event.preventDefault();
  const manifest = {name:$('#skillName').value.trim(), version:'0.1.0', purpose:$('#skillPurpose').value.trim(), permission:$('#skillPermission').value, inputs:['user-approved content'], outputs:['reviewed local artifact'], status:'draft; human review required'};
  $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">SKILL MANIFEST</span><pre class="extract">${escapeHtml(JSON.stringify(manifest, null, 2))}</pre><button class="download" id="downloadSkill">Download JSON</button></article>`;
  $('#downloadSkill').onclick = () => downloadFile(`${slug(manifest.name)}.json`, JSON.stringify(manifest, null, 2), 'application/json');
}

function buildWorkflow(event) {
  event.preventDefault();
  const goal = $('#agentGoal').value.trim();
  const gate = $('#agentGate').value;
  const steps = ['Clarify goal and allowed sources','Research public information read-only','Draft the requested artifact','Run local quality and safety checks',`Pause: ${gate}`,'Export only after approval'];
  $('#result').innerHTML = `<article class="result-card"><span class="eyebrow">AUDITABLE WORKFLOW</span><h2>${escapeHtml(goal)}</h2><ol>${steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol><p class="boundary">This is a plan. No external action was executed.</p></article>`;
}

function animateAudio(audio) {
  const portrait = $('#speakingPortrait');
  if (!audio || !portrait) return;
  audio.onplay = () => portrait.classList.add('is-speaking');
  audio.onpause = audio.onended = () => portrait.classList.remove('is-speaking');
}

function busy(button, on, label) { if (button) { button.disabled = on; button.textContent = label; } }
function showError(error) { $('#result').innerHTML = `<div class="error"><b>Could not complete that action.</b><p>${escapeHtml(error.message)}</p></div>`; }
function slug(value) { return String(value || 'wilkerson-build').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wilkerson-build'; }
function downloadFile(name, content, type) { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([content], {type})); link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }

$$('[data-mode]').forEach(button => button.onclick = () => { setMode(button.dataset.mode); history.replaceState(null, '', `#${button.dataset.mode}`); });
$$('[data-open]').forEach(button => button.onclick = () => { setMode(button.dataset.open); history.replaceState(null, '', `#${button.dataset.open}`); window.scrollTo({top:$('.workbench').offsetTop - 20, behavior:'smooth'}); });
$('#accessForm').onsubmit = submitAccess;
setupInstallAndTv();
const suppliedPin = new URLSearchParams(location.search).get('pin');
if (/^\d{6}$/.test(suppliedPin || '')) {
  localStorage.setItem('wilkersonAccessPin', suppliedPin);
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete('pin');
  history.replaceState(null, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}
const requestedMode = location.hash.slice(1);
setMode(modes[requestedMode] ? requestedMode : 'sovereign');
window.addEventListener('hashchange', () => { const mode = location.hash.slice(1); if (modes[mode]) setMode(mode); });
setupAccess().then(() => refreshLocalStatus());
setInterval(refreshLocalStatus, 30000);
