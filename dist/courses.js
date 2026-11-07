(() => {
  const courses = [
    { name: 'COMP7610 Introduction to Web3 and Blockchain', glyph: 'W', meta: 'Current · 24 learners', current: true },
    { name: 'COMP7810 Topic in Web3', glyph: 'T', meta: 'Completed · Sep 2026', current: false },
    { name: 'COMP7409 Machine Learning in Trading and Finance', glyph: 'M', meta: 'Completed · Jun 2026', current: false }
  ];
  const trigger = document.querySelector('#course-trigger');
  const menu = document.querySelector('#course-menu');
  const askButton = document.querySelector('#open-question');
  const sponsorBanner = document.querySelector('#starter-banner');
  const courseNameMarkup = name => {
    const [code, ...titleParts] = name.split(' ');
    return `<span class="course-code">${escapeHtml(code)}</span><span class="course-title">${escapeHtml(titleParts.join(' '))}</span>`;
  };

  function renderMenu() {
    menu.innerHTML = courses.map(course => `<button type="button" data-course="${escapeHtml(course.name)}" class="${course.name === activeCourse ? 'selected' : ''}"><span><strong>${courseNameMarkup(course.name)}</strong><small>${course.meta}</small></span>${course.name === activeCourse ? '<span class="course-check">✓</span>' : ''}</button>`).join('');
    menu.querySelectorAll('[data-course]').forEach(button => button.onclick = () => selectCourse(button.dataset.course));
  }

  function selectCourse(name) {
    const course = courses.find(item => item.name === name);
    if (!course) return;
    activeCourse = course.name;
    document.querySelector('#course-name').innerHTML = courseNameMarkup(course.name);
    document.querySelector('#course-meta').textContent = course.meta;
    document.querySelector('#course-board-label').textContent = `${course.name.toUpperCase()} / QUESTION BOARD`;
    document.querySelector('#course-board-description').textContent = course.current ? 'Ask clearly. Explain generously. Learn together.' : 'Course history · questions and explanations remain available to review.';
    askButton.disabled = !course.current;
    askButton.innerHTML = course.current ? '<span>＋</span> Ask a question' : '<span>✓</span> Course completed';
    if (sponsorBanner) sponsorBanner.style.display = course.current ? '' : 'none';
    menu.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    renderMenu();
    renderQuestions();
    renderClassmates();
  }

  trigger.onclick = () => {
    const opening = !menu.classList.contains('open');
    menu.classList.toggle('open', opening);
    trigger.setAttribute('aria-expanded', String(opening));
  };
  document.addEventListener('click', event => {
    if (!event.target.closest('.course-switcher')) {
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });
  renderMenu();
})();
