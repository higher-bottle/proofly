(() => {
  const defaults = ['Solidity', 'Consensus', 'Smart Contracts', 'Tokenomics'];
  const fromQuestions = questions.flatMap(question => question.topics || [question.topic]);
  let topics = [...new Set([...defaults, ...fromQuestions].filter(Boolean))];
  const selected = new Set(['Solidity']);
  const draftTopics = new Set();
  const feedState = document.querySelector('#topic-filter');
  const feedTrigger = document.querySelector('#feed-topic-trigger');
  const feedPanel = document.querySelector('#feed-topic-panel');
  const feedSearch = document.querySelector('#feed-topic-search');
  const feedOptions = document.querySelector('#feed-topic-options');
  const formTrigger = document.querySelector('#question-topic-trigger');
  const formPanel = document.querySelector('#question-topic-panel');
  const formSearch = document.querySelector('#question-topic-search');
  const formOptions = document.querySelector('#question-topic-options');
  const summary = document.querySelector('#question-topic-summary');

  const clean = value => value.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 32);
  const save = () => localStorage.setItem('proofly-topics', JSON.stringify(topics));
  const matches = (topic, query) => topic.toLowerCase().includes(query.trim().toLowerCase());
  const close = (panel, trigger) => { panel.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); };
  const toggle = (panel, trigger, input) => {
    const opening = !panel.classList.contains('open');
    document.querySelectorAll('.topic-picker-panel.open').forEach(open => open.classList.remove('open'));
    document.querySelectorAll('.topic-picker-trigger[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    if (opening) { panel.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); setTimeout(() => input.focus(), 0); }
  };

  function renderFeed(query = '') {
    feedState.innerHTML = '<option value="all">All topics</option>' + topics.map(topic => `<option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>`).join('');
    feedTrigger.innerHTML = feedTopicSelection.size ? `<span class="mantine-values">${[...feedTopicSelection].map(topic => `<span class="mantine-pill">${escapeHtml(topic)}</span>`).join('')}</span><span>⌄</span>` : '<span class="topic-placeholder">All topics</span><span>⌄</span>';
    const visible = topics.filter(topic => matches(topic, query));
    feedOptions.innerHTML = `<button type="button" class="topic-clear" data-clear-topics>${feedTopicSelection.size ? 'Clear selection' : 'All topics'}</button>` + visible.map(topic => `<label><input type="checkbox" value="${escapeHtml(topic)}" ${feedTopicSelection.has(topic) ? 'checked' : ''}><span>${escapeHtml(topic)}</span></label>`).join('');
    feedOptions.querySelector('[data-clear-topics]').onclick = () => { feedTopicSelection.clear(); renderFeed(query); renderQuestions(); };
    feedOptions.querySelectorAll('input[type="checkbox"]').forEach(input => input.onchange = () => {
      input.checked ? feedTopicSelection.add(input.value) : feedTopicSelection.delete(input.value);
      renderFeed(query);
      renderQuestions();
    });
  }

  function renderForm(query = '') {
    const available = [...new Set([...topics, ...draftTopics])];
    const visible = available.filter(topic => matches(topic, query));
    formOptions.innerHTML = visible.length ? visible.map(topic => `<label><input type="checkbox" name="topics" value="${escapeHtml(topic)}" ${selected.has(topic) ? 'checked' : ''}><span>${escapeHtml(topic)}</span></label>`).join('') : '<div class="topic-empty">No matching topic. Press Enter to add it.</div>';
    formOptions.querySelectorAll('input[name="topics"]').forEach(input => input.onchange = () => {
      input.checked ? selected.add(input.value) : selected.delete(input.value);
      updateSummary();
    });
    updateSummary();
  }

  function updateSummary() {
    summary.textContent = selected.size ? [...selected].join(', ') : 'Choose topics';
  }

  function addTopic(value) {
    const topic = clean(value);
    if (!topic) return;
    const existing = [...topics, ...draftTopics].find(item => item.toLowerCase() === topic.toLowerCase());
    const chosen = existing || topic;
    if (!existing) draftTopics.add(chosen);
    selected.add(chosen);
    formSearch.value = '';
    renderForm();
  }

  feedTrigger.onclick = () => toggle(feedPanel, feedTrigger, feedSearch);
  formTrigger.onclick = () => toggle(formPanel, formTrigger, formSearch);
  feedSearch.oninput = () => renderFeed(feedSearch.value);
  formSearch.oninput = () => renderForm(formSearch.value);
  formSearch.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); addTopic(formSearch.value); }
  };
  document.addEventListener('click', event => {
    if (!event.target.closest('.topic-picker')) {
      close(feedPanel, feedTrigger);
      close(formPanel, formTrigger);
    }
  });
  document.querySelector('#open-question').addEventListener('click', () => { draftTopics.clear();selected.clear();selected.add('Solidity');renderForm(); });
  document.addEventListener('proofly:question-published', event => {
    topics = [...new Set([...topics, ...event.detail.topics])];
    draftTopics.clear();
    save();
    renderFeed(feedSearch.value);
    setTimeout(() => { selected.clear(); selected.add('Solidity'); renderForm(); }, 0);
  });
  renderFeed();
  renderForm();
})();
