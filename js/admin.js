const configured = window.supabase && window.SUPABASE_URL && window.SUPABASE_PUBLISHABLE_KEY && !window.SUPABASE_URL.includes('PASTE_') && !window.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
const adminClient = configured && window.supabase ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY, {
  auth: { storageKey: 'sama-private-chat-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;
const loginPanel = document.querySelector('#admin-login');
const loginForm = document.querySelector('#admin-login-form');
const loginError = document.querySelector('#admin-login-error');
const chatPanel = document.querySelector('#admin-chat');
const status = document.querySelector('#admin-status');
const messages = document.querySelector('#admin-messages');
const replyForm = document.querySelector('#admin-reply-form');
const reply = document.querySelector('#admin-reply');
const sendButton = document.querySelector('#admin-send');
let adminUser = null;
let samaUserId = null;
let subscription = null;
const renderedMessageIds = new Set();

function setLoginError(text) { loginError.textContent = text; loginError.hidden = !text; }
function setStatus(text) { status.textContent = text; }
function formatTime(value) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
function renderMessage(message) {
  if (!message || renderedMessageIds.has(message.id)) return;
  renderedMessageIds.add(message.id);
  const bubble = document.createElement('article');
  bubble.className = `admin-bubble admin-bubble--${message.sender === 'anas' ? 'anas' : 'sama'}`;
  const sender = document.createElement('span'); sender.textContent = message.sender === 'anas' ? 'You' : 'Sama';
  const content = document.createElement('p'); content.textContent = message.message || '';
  const time = document.createElement('time'); time.dateTime = message.created_at; time.textContent = formatTime(message.created_at);
  bubble.append(sender, content, time); messages.append(bubble); messages.scrollTop = messages.scrollHeight;
}
async function isAdmin() {
  const { data, error } = await adminClient.rpc('is_chat_admin');
  if (error) console.error('Admin verification failed.', error);
  return !error && data === true;
}
async function findSamaUser() {
  const latestSamaMessage = await adminClient.from('chat_messages').select('user_id, created_at').eq('sender', 'sama').order('created_at', { ascending: false }).limit(1);
  if (!latestSamaMessage.error && latestSamaMessage.data?.[0]?.user_id) return latestSamaMessage.data[0].user_id;
  const access = await adminClient.from('chat_access').select('user_id, created_at').order('created_at', { ascending: false }).limit(1);
  return access.data?.[0]?.user_id || null;
}
async function markSamaMessagesRead(rows) {
  const unread = rows.filter(row => row.sender === 'sama' && !row.read_at).map(row => row.id);
  if (unread.length) await adminClient.from('chat_messages').update({ read_at: new Date().toISOString() }).in('id', unread);
}
async function loadMessages() {
  renderedMessageIds.clear(); messages.replaceChildren();
  if (!samaUserId) { setStatus('No Sama chat access has been created yet.'); return; }
  setStatus('Loading messages…');
  const { data, error } = await adminClient.from('chat_messages').select('*').eq('user_id', samaUserId).order('created_at', { ascending: true });
  if (error) { setStatus('Messages could not be loaded.'); return; }
  data.forEach(renderMessage);
  await markSamaMessagesRead(data);
  setStatus(data.length ? '' : 'No messages yet.');
}
async function subscribe() {
  if (subscription || !samaUserId) return;
  subscription = adminClient.channel(`admin-sama-${samaUserId}`).on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `user_id=eq.${samaUserId}`
  }, async payload => {
    renderMessage(payload.new);
    if (payload.new.sender === 'sama') await markSamaMessagesRead([payload.new]);
  }).subscribe();
}
async function showChat() {
  samaUserId = await findSamaUser();
  loginPanel.hidden = true; chatPanel.hidden = false;
  await loadMessages(); await subscribe();
}
async function checkExistingSession() {
  if (!configured) { setLoginError('Add the Supabase project URL and publishable key in js/supabase-config.js first.'); return; }
  const { data } = await adminClient.auth.getSession();
  if (data.session?.user && await isAdmin()) { adminUser = data.session.user; await showChat(); }
}
async function submitAdminLogin() {
  if (!configured) { setLoginError('Add the Supabase project URL and publishable key in js/supabase-config.js first.'); return; }
  const email = document.querySelector('#admin-email').value.trim();
  const password = document.querySelector('#admin-password').value;
  if (!email || !password) { setLoginError('Enter your Supabase admin email and password.'); return; }
  setLoginError('');
  const { data, error } = await adminClient.auth.signInWithPassword({ email, password });
  if (error || !data.user || !(await isAdmin())) {
    if (data.session) await adminClient.auth.signOut();
    setLoginError('This account is not allowed to access the private messages.');
    return;
  }
  adminUser = data.user;
  await showChat();
}
loginForm.addEventListener('submit', event => { event.preventDefault(); submitAdminLogin(); });
document.querySelector('#admin-login-button').addEventListener('click', submitAdminLogin);
replyForm.addEventListener('submit', async event => {
  event.preventDefault();
  const content = reply.value.trim();
  if (!content || !samaUserId || !adminUser) return;
  sendButton.disabled = true; setStatus('Sending…');
  const { data, error } = await adminClient.from('chat_messages').insert({ user_id: samaUserId, sender: 'anas', message: content }).select().single();
  sendButton.disabled = false;
  if (error) { setStatus('Reply could not be sent.'); return; }
  reply.value = ''; renderMessage(data); setStatus('');
});
document.querySelector('#admin-logout').addEventListener('click', async () => {
  if (subscription) await adminClient.removeChannel(subscription);
  subscription = null; samaUserId = null; adminUser = null;
  await adminClient.auth.signOut();
  chatPanel.hidden = true; loginPanel.hidden = false; loginForm.reset();
});
checkExistingSession();
