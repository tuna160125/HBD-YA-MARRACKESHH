const configured = window.supabase && window.SUPABASE_URL && window.SUPABASE_PUBLISHABLE_KEY && !window.SUPABASE_URL.includes('PASTE_') && !window.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
const chatClient = configured && window.supabase ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY, {
  auth: { storageKey: 'sama-private-chat-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;
const entry = document.querySelector('#chat-entry');
const overlay = document.querySelector('#chat-overlay');
const closeButton = document.querySelector('#chat-close');
const accessPanel = document.querySelector('#chat-access');
const conversation = document.querySelector('#chat-conversation');
const accessCode = document.querySelector('#chat-code');
const codeMask = document.querySelector('#chat-code-mask');
const codeToggle = document.querySelector('#chat-code-toggle');
const accessError = document.querySelector('#chat-access-error');
const unlockButton = document.querySelector('#chat-unlock');
const status = document.querySelector('#chat-status');
const messages = document.querySelector('#chat-messages');
const form = document.querySelector('#chat-form');
const messageInput = document.querySelector('#chat-message');
const sendButton = document.querySelector('#chat-send');
let user = null;
let subscription = null;
let isCodeVisible = false;
const renderedMessageIds = new Set();

function setStatus(text) { status.textContent = text; }
function showAccessError(text) { accessError.textContent = text; accessError.hidden = !text; }
function updateCodeMask() {
  const codeLength = accessCode.value.length;
  accessCode.classList.toggle('is-masked', !isCodeVisible);
  codeMask.textContent = '♥'.repeat(codeLength);
  codeMask.hidden = isCodeVisible || !codeLength;
  codeToggle.textContent = isCodeVisible ? 'Hide password' : 'Show password';
  codeToggle.setAttribute('aria-pressed', String(isCodeVisible));
}
function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}
function scrollMessages() { messages.scrollTop = messages.scrollHeight; }
function renderMessage(message) {
  if (!message || renderedMessageIds.has(message.id)) return;
  renderedMessageIds.add(message.id);
  const bubble = document.createElement('article');
  bubble.className = `chat-bubble chat-bubble--${message.sender === 'anas' ? 'anas' : 'sama'}`;
  const label = document.createElement('span');
  label.className = 'chat-bubble__sender';
  label.textContent = message.sender === 'anas' ? 'Anas' : 'Sama';
  const text = document.createElement('p');
  text.textContent = message.message || '';
  const time = document.createElement('time');
  time.dateTime = message.created_at;
  time.textContent = formatTime(message.created_at);
  bubble.append(label, text, time);
  messages.append(bubble);
  scrollMessages();
}
async function markAnasMessagesRead(rows) {
  const unread = rows.filter(row => row.sender === 'anas' && !row.read_at).map(row => row.id);
  if (!unread.length || !user) return;
  await chatClient.from('chat_messages').update({ read_at: new Date().toISOString() }).in('id', unread).eq('user_id', user.id);
}
async function loadMessages() {
  renderedMessageIds.clear();
  messages.replaceChildren();
  setStatus('Loading our conversation…');
  const { data, error } = await chatClient.from('chat_messages').select('*').eq('user_id', user.id).order('created_at', { ascending: true });
  if (error) { setStatus('Your conversation could not be loaded right now.'); return; }
  data.forEach(renderMessage);
  await markAnasMessagesRead(data);
  setStatus(data.length ? '' : 'No messages yet. Leave the first little note.');
}
async function subscribeToMessages() {
  if (subscription || !user) return;
  subscription = chatClient.channel(`sama-chat-${user.id}`).on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `user_id=eq.${user.id}`
  }, async payload => {
    renderMessage(payload.new);
    if (payload.new.sender === 'anas') {
      entry.classList.toggle('chat-entry--unread', overlay.hidden);
      await markAnasMessagesRead([payload.new]);
    }
  }).subscribe();
}
async function clearSubscription() {
  if (!subscription) return;
  await chatClient.removeChannel(subscription);
  subscription = null;
}
async function ensureAnonymousSession() {
  const { data: sessionData } = await chatClient.auth.getSession();
  user = sessionData.session?.user || null;
  if (!user) {
    const { data, error } = await chatClient.auth.signInAnonymously();
    if (error) throw error;
    user = data.user;
  }
  return user;
}
async function openConversation() {
  accessPanel.hidden = true;
  conversation.hidden = false;
  entry.classList.remove('chat-entry--unread');
  await loadMessages();
  await subscribeToMessages();
  messageInput.focus();
}
async function openChat() {
  overlay.hidden = false;
  document.body.classList.add('chat-is-open');
  showAccessError('');
  accessCode.value = '';
  isCodeVisible = false;
  updateCodeMask();
  accessPanel.hidden = false;
  conversation.hidden = true;
  if (!configured) {
    showAccessError('Chat setup is not complete yet.');
    return;
  }
  try {
    await ensureAnonymousSession();
    // Chat access is deliberately checked on every opening, even though the
    // anonymous user and their conversation remain persistent.
    accessCode.focus();
  } catch {
    showAccessError('We could not open the private chat right now. Please try again.');
  }
}
async function closeChat() {
  overlay.hidden = true;
  document.body.classList.remove('chat-is-open');
  accessCode.value = '';
  isCodeVisible = false;
  updateCodeMask();
  accessPanel.hidden = false;
  conversation.hidden = true;
  await clearSubscription();
}

window.addEventListener('sama:open-chat', openChat);
closeButton.addEventListener('click', closeChat);
overlay.addEventListener('click', event => { if (event.target === overlay) closeChat(); });
unlockButton.addEventListener('click', async () => {
  const code = accessCode.value.trim();
  if (!code) { showAccessError('Please enter the little code first.'); return; }
  unlockButton.disabled = true;
  showAccessError('');
  const { data, error } = await chatClient.rpc('verify_sama_code', { p_code: code });
  unlockButton.disabled = false;
  if (error) { console.error('Chat access verification failed.', error); showAccessError('The private chat is not ready right now. Please try again later.'); return; }
  if (data !== true) { showAccessError('That code is not quite right. Try again, my love.'); return; }
  accessCode.value = '';
  updateCodeMask();
  await openConversation();
});
codeToggle.addEventListener('click', () => {
  isCodeVisible = !isCodeVisible;
  updateCodeMask();
  accessCode.focus();
});
accessCode.addEventListener('input', updateCodeMask);
accessCode.addEventListener('keydown', event => { if (event.key === 'Enter') unlockButton.click(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const content = messageInput.value.trim();
  if (!content || !user) return;
  sendButton.disabled = true;
  setStatus('Sending…');
  const { data, error } = await chatClient.from('chat_messages').insert({ user_id: user.id, sender: 'sama', message: content }).select().single();
  sendButton.disabled = false;
  if (error) { setStatus('Your message could not be sent. Please try again.'); return; }
  messageInput.value = '';
  renderMessage(data);
  setStatus('');
});
window.addEventListener('sama:gifts-complete', () => { entry.hidden = false; });
updateCodeMask();
