// Deliberately small, inspectable offline fallback. No LLM, learned weights,
// network access, eval, or claim of general-purpose intelligence.
const stopWords = new Set('a an and are as at be by can do for from how i in is it me my of on or that the this to was we what with you your'.split(' '));
const words = text => (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length > 1 && !stopWords.has(w));
const knowledge = [
  { keywords: 'privacy private local device data storage safe secure history encrypted encryption cloud',
    text: 'Your messages stay in this browser’s local storage. Offline tools run here, without a network request for your message.\n\nIf you choose Ollama, the app sends the conversation over loopback to a model on this same computer. There are no accounts, analytics, or cloud sync.\n\nHistory is not encrypted. Anyone with access to this browser profile may be able to read it. You can delete chats in Privacy & storage.' },
  { keywords: 'focus concentrate concentration distraction distractions productive productivity procrastinate work',
    text: 'Make the next step small enough to start:\n\n1. Write down one thing you want to finish.\n2. Close anything unrelated and silence notifications.\n3. Give it 25 minutes of your attention.\n4. Take a short break, then choose the next step.\n\nIf you tell me “Plan: …” followed by your tasks, I can turn them into a simple sequence.' },
  { keywords: 'help capabilities tools able offline assistant summarize calculate plan',
    text: 'I’m the small offline assistant built into Still. I can:\n\n• Summarize: paste a paragraph after “Summarize:”.\n• Plan: list tasks after “Plan:”.\n• Calculate: try “(120 + 45) / 3”.\n• Remember a name mentioned in this conversation.\n• Explain how this app keeps your chats local.\n\nI use rules and text retrieval, not a language model. For open-ended writing or questions, choose Ollama in the engine menu.' },
  { keywords: 'ollama model language llm connect install setup llama weights',
    text: 'For a full local language model, install Ollama and download llama3.2:1b. Run the Ollama server with OLLAMA_NO_CLOUD=1, then open Still with npm start on the same computer.\n\nIn the engine menu, choose “Check local model”. Still only connects to 127.0.0.1:11434 and refuses remote models. Downloading weights needs internet once; generating replies stays local.\n\nThis environment does not include the model weights. The built-in offline tools work without them.' },
  { keywords: 'delete remove clear erase forget conversation chats history',
    text: 'To delete this conversation, open the three-dot menu in the top right and choose “Delete conversation”. To remove every chat, open Privacy & storage.\n\nDeletion removes the saved history from this browser. It does not erase text copies you exported, OS backups, or guarantee forensic deletion from disk.' },
  { keywords: 'mobile phone tablet desktop responsive browser app native',
    text: 'Still is a responsive web app. Offline tools run in your browser on mobile or desktop, and each browser keeps its own history.\n\nThe Ollama option is only available through Still’s local server on the same device. A phone does not send its messages to a desktop model in this prototype.' }
];

// Tiny bag-of-words retrieval index over the bundled, inspectable help corpus.
const docs = knowledge.map(d => new Set(words(d.keywords)));
function retrieve(query) {
  const tokens = [...new Set(words(query))];
  if (!tokens.length) return null;
  const scored = docs.map((doc, i) => {
    const overlap = tokens.filter(t => doc.has(t));
    const score = overlap.reduce((sum, t) => sum + Math.log(1 + docs.length / docs.filter(d => d.has(t)).length), 0);
    return { i, score, count: overlap.length };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best.score >= 1.5 && best.count / tokens.length >= .22 ? knowledge[best.i].text : null;
}

// Recursive-descent arithmetic: no evaluation of code or property access.
export function calculate(expression) {
  if (expression.length > 300) throw new Error('Please use a shorter calculation (up to 300 characters).');
  if (/\d\s+\d/.test(expression)) throw new Error('Put an operator between separate numbers.');
  const source = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  const tokens = source.match(/\d*\.?\d+(?:e[+-]?\d+)?|[()+*/%^+-]/gi) || [];
  if (!tokens.length || tokens.join('') !== source) throw new Error('Use numbers, parentheses, +, −, *, /, ^, and % only.');
  let position = 0;
  function primary() {
    let value;
    const token = tokens[position++];
    if (token === '(') {
      value = sum();
      if (tokens[position++] !== ')') throw new Error('Check that every opening parenthesis has a closing one.');
    } else if (token && /^\d*\.?\d/.test(token)) value = Number(token);
    else throw new Error('That calculation is incomplete. Check the numbers and operators.');
    while (tokens[position] === '%') { position++; value /= 100; }
    return value;
  }
  function power() {
    const left = primary();
    if (tokens[position] === '^') { position++; return left ** unary(); }
    return left;
  }
  function unary() {
    if (tokens[position] === '+') { position++; return unary(); }
    if (tokens[position] === '-') { position++; return -unary(); }
    return power();
  }
  function product() {
    let value = unary();
    while (['*', '/'].includes(tokens[position])) {
      const op = tokens[position++], rhs = unary();
      if (op === '/' && rhs === 0) throw new Error('Division by zero is undefined.');
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }
  function sum() {
    let value = product();
    while (['+', '-'].includes(tokens[position])) {
      const op = tokens[position++], rhs = product();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  const value = sum();
  if (position !== tokens.length) throw new Error('There is an unexpected number or operator in that calculation.');
  if (!Number.isFinite(value)) throw new Error('That result is outside the supported numeric range.');
  return Number(value.toPrecision(12)).toString();
}

export function summarize(text, limit = 3) {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+(?=\s|$)|$)/g)?.map(s => s.trim()).filter(Boolean) || [text.trim()];
  const frequencies = new Map();
  for (const word of words(text)) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  const scored = sentences.map((sentence, index) => {
    const tokens = words(sentence);
    const relevance = tokens.reduce((sum, t) => sum + (frequencies.get(t) || 0), 0) / Math.sqrt(tokens.length || 1);
    const action = /\b(next|will|must|deadline|decision|agreed|but|however)\b/i.test(sentence) ? 2 : 0;
    return { sentence, index, score: relevance + action + (index === 0 ? 2 : 0) };
  });
  const selected = scored.sort((a,b) => b.score - a.score).slice(0, limit).sort((a,b) => a.index - b.index);
  return 'Here are the essentials, in your own words:\n\n' + selected.map(s => '• ' + s.sentence).join('\n\n') +
    '\n\nThis is an extractive summary: selected sentences, without adding facts.';
}

function plan(text) {
  const tasks = text.replace(/[.]+$/, '').split(/[,;\n]+|\s+and\s+/i)
    .map(t => t.trim().replace(/^(?:and\s+|[-•]\s*|\d+[.)]\s*)/i, '')).filter(Boolean).slice(0, 8);
  if (!tasks.length) return 'Tell me what you want to make room for. Try “Plan: finish my proposal, clear my inbox, take a walk”.';
  return 'Let’s give each thing a little room. Here’s a suggested sequence:\n\n' +
    tasks.map((t, i) => (i + 1) + '. ' + t.charAt(0).toUpperCase() + t.slice(1) +
      (i === 0 ? '\n   Start here. Give this one focused block before switching tasks.' : i === tasks.length - 1 ? '\n   Finish here, then leave a little breathing room.' : '\n   Take a short pause before moving on.')).join('\n\n') +
    '\n\nI’ve kept your order. Move the most important task to the top if needed.';
}

export function reply(messages) {
  const latest = messages.filter(m => m.role === 'user').at(-1)?.content.trim() || '';
  const previous = messages.slice(0, -1);
  const lower = latest.toLowerCase();
  if (/^(hi|hello|hey|good morning|good evening)[!.\s]*$/i.test(latest)) {
    return 'Hello. A little space, just for you.\n\nI’m Still’s offline assistant. I can make a simple plan, pick out the essentials from a note, or work through a calculation. What would you like to start with?';
  }
  const name = latest.match(/\b(?:my name is|call me)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž '-]{0,40}?)(?:[.!?,\n]|$)/i);
  if (name) return 'Nice to meet you, ' + name[1].trim() + '. I can refer back to that in this conversation. It stays in this browser with your chat history.';
  if (/\b(?:what(?:'s| is) my name|remember my name|who am i)\b/i.test(latest)) {
    const named = [...previous].reverse().filter(m => m.role === 'user').map(m => m.content.match(/\b(?:my name is|call me)\s+([A-Za-zÀ-ž][A-Za-zÀ-ž '-]{0,40}?)(?:[.!?,\n]|$)/i)).find(Boolean);
    return named ? 'You told me your name is ' + named[1].trim() + '. I found that in this conversation’s local history.' : 'You haven’t told me a name in this conversation. You can say “My name is …” if you’d like.';
  }
  if (/\b(?:shorter|shorten|more concise)\b/.test(lower)) {
    const last = [...previous].reverse().find(m => m.role === 'assistant' && m.status !== 'error');
    return last ? summarize(last.content, 2) : 'Send a note after “Summarize:” and I’ll pick out its key sentences.';
  }
  if (/^(summari[sz]e|summary|tl;?dr|find the essentials)\b/i.test(latest)) {
    let content = latest.replace(/^(?:summari[sz]e|summary|tl;?dr|find the essentials)(?:\s+(?:these|this|the))?(?:\s+(?:notes?|text|paragraph))?\s*[:\n]?\s*/i, '');
    if (/^(this|that|it|our conversation)[.!?]*$/i.test(content)) {
      content = previous.filter(m => m.role === 'user').map(m => m.content).join('\n');
    }
    return content.length >= 30 ? summarize(content) : 'Paste the note you’d like me to summarize after “Summarize:”. A few sentences will give me enough to work with.';
  }
  if (/\b(plan|schedule|organize|prioriti[sz]e)\b/i.test(latest)) {
    const separator = latest.search(/[:\n]/);
    return plan(separator >= 0 ? latest.slice(separator + 1) : '');
  }
  let expression = latest.replace(/^(?:what is|what's|calculate|work out|compute)\s*:?\s*/i, '').replace(/[?=]\s*$/, '').trim();
  expression = expression.replace(/(\d+(?:\.\d+)?)\s*%\s+of\s+(\d+(?:\.\d+)?)/gi, '($1 / 100 * $2)');
  if (/^[\d\s.()+*/%^×÷−eE+-]+$/.test(expression) && /\d/.test(expression)) {
    try { return expression + ' = ' + calculate(expression) + '\n\nCalculated on this device. Percent means “divided by 100”; use parentheses to group operations.'; }
    catch (error) { return error.message; }
  }
  if (/^(thanks|thank you|thank you so much|great|perfect)[!.\s]*$/i.test(latest)) return 'You’re welcome. This space is here whenever you want to keep going.';
  const result = retrieve(latest);
  if (result) return result;
  return 'That’s beyond my small offline toolkit. I don’t have a language model loaded, so I can’t give a reliable open-ended answer.\n\nI can still help with a specific task:\n• “Summarize:” followed by your notes\n• “Plan:” followed by your tasks\n• A calculation, like “(85 + 15) / 4”\n\nFor a fuller conversation, connect a local model through the engine menu. Your message has stayed on this device.';
}
