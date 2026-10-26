const seedQuestions = [
  {id:1,topic:'Solidity',title:'Why does this reentrancy guard prevent a second withdrawal?',body:'I understand the lock modifier, but I’m confused about when the state changes relative to the external call.',author:'Maya Chen',initials:'MC',color:'#ffdfcc',bounty:7,answers:4,time:'18 min ago',status:'open'},
  {id:2,topic:'Consensus',title:'How is a validator selected in Proof of Stake?',body:'Is selection purely random, or does the amount staked change the probability? I’m looking for an intuitive explanation.',author:'Liam Park',initials:'LP',color:'#dcecff',bounty:5,answers:3,time:'42 min ago',status:'open'},
  {id:3,topic:'Smart Contracts',title:'Storage vs memory: when should a struct use each?',body:'My function compiles with both in different places. What changes in cost and persistence?',author:'Sofia Malik',initials:'SM',color:'#e7e0ff',bounty:3,answers:2,time:'1 hr ago',status:'open'},
  {id:4,topic:'Tokenomics',title:'Why can a fixed token supply still change in market value?',body:'I’m mixing up supply, utility, and price. Can someone explain with a classroom-token example?',author:'Noah Williams',initials:'NW',color:'#dff1d4',bounty:5,answers:1,time:'3 hrs ago',status:'open'},
  {id:5,topic:'Solidity',title:'What does the payable keyword actually enable?',body:'I thought every contract could receive ETH. What specifically changes when a function is payable?',author:'Ava Johnson',initials:'AJ',color:'#ffe8a8',bounty:3,answers:5,time:'Yesterday',status:'answered'},
  {id:6,topic:'Consensus',title:'Why would a blockchain need finality?',body:'How is finality different from simply adding more confirmations to a block?',author:'Ethan Zhao',initials:'EZ',color:'#d6eee7',bounty:7,answers:6,time:'2 days ago',status:'answered'}
];
const classmates=[
  {name:'Maya Chen',initials:'MC',color:'#ffdfcc',answers:18,best:8,tags:['Solidity','Security']},
  {name:'Liam Park',initials:'LP',color:'#dcecff',answers:14,best:6,tags:['Consensus','PoS']},
  {name:'Sofia Malik',initials:'SM',color:'#e7e0ff',answers:12,best:5,tags:['EVM','Smart contracts']},
  {name:'Noah Williams',initials:'NW',color:'#dff1d4',answers:11,best:4,tags:['Tokenomics','DeFi']},
  {name:'Ava Johnson',initials:'AJ',color:'#ffe8a8',answers:9,best:3,tags:['Solidity','Testing']},
  {name:'Ethan Zhao',initials:'EZ',color:'#d6eee7',answers:7,best:2,tags:['Cryptography','L2']}
];
let questions=JSON.parse(localStorage.getItem('proofly-questions')||'null')||seedQuestions;
let activeFilter='all',activeAnswerId=null,balance=Number(localStorage.getItem('proofly-balance')||28);
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const escapeHtml=s=>s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
function renderQuestions(){
  const topic=$('#topic-filter').value;
  const shown=questions.filter(q=>(activeFilter==='all'||q.status===activeFilter)&&(topic==='all'||q.topic===topic));
  $('#question-list').innerHTML=shown.length?shown.map(q=>`<article class="question-card"><div><div class="q-top"><span class="topic">${q.topic}</span><span class="state">${q.status==='open'?'● Accepting answers':'✓ Solved'}</span></div><h3>${escapeHtml(q.title)}</h3><p>${escapeHtml(q.body)}</p><div class="q-meta"><span class="author"><span class="avatar" style="background:${q.color}">${q.initials}</span>${q.author}</span><span>${q.answers} explanation${q.answers===1?'':'s'}</span><span>${q.time}</span></div></div><div class="q-aside"><div class="bounty"><span class="token-symbol">H</span>${q.bounty} HELP</div>${q.status==='open'?`<button class="answer-button" data-answer="${q.id}">Explain this →</button>`:'<span class="solved-mark">Best answer chosen</span>'}</div></article>`).join(''):'<div class="empty">No questions match this view yet.</div>';
  $('#all-count').textContent=questions.length;$('#open-count').textContent=questions.filter(q=>q.status==='open').length;$('#solved-count').textContent=questions.filter(q=>q.status==='answered').length;
  $$('[data-answer]').forEach(b=>b.onclick=()=>openAnswer(Number(b.dataset.answer)));
}
function renderClassmates(filter=''){const f=filter.toLowerCase();$('#classmate-grid').innerHTML=classmates.filter(c=>c.name.toLowerCase().includes(f)||c.tags.join(' ').toLowerCase().includes(f)).map(c=>`<article class="classmate-card"><div class="avatar" style="background:${c.color}">${c.initials}</div><h3>${c.name}</h3><p>Blockchain 101 · 0x${Math.random().toString(16).slice(2,6)}...${Math.random().toString(16).slice(2,6)}</p><div class="stats"><div><strong>${c.answers}</strong><small>answers shared</small></div><div><strong>${c.best}</strong><small>best answers</small></div></div><div class="skill-tags">${c.tags.map(t=>`<span>${t}</span>`).join('')}</div></article>`).join('')}
function setBalance(n){balance=n;localStorage.setItem('proofly-balance',n);$('#top-balance').textContent=n;$('#profile-balance').textContent=n}
function openModal(el){el.classList.add('open');el.setAttribute('aria-hidden','false');setTimeout(()=>el.querySelector('input,textarea')?.focus(),50)}
function closeModals(){$$('.modal-backdrop').forEach(m=>{m.classList.remove('open');m.setAttribute('aria-hidden','true')})}
function openAnswer(id){activeAnswerId=id;const q=questions.find(x=>x.id===id);$('#answer-title').textContent=`Help ${q.author.split(' ')[0]} understand`;openModal($('#answer-modal'))}
function toast(title,message){$('#toast-title').textContent=title;$('#toast-message').textContent=message;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3200)}
$$('.nav-item').forEach(b=>b.onclick=()=>{$$('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');$$('.view').forEach(v=>v.classList.remove('active'));$(`#${b.dataset.view}-view`).classList.add('active');$('.sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'})});
$$('.tab').forEach(b=>b.onclick=()=>{$$('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeFilter=b.dataset.filter;renderQuestions()});
$('#topic-filter').onchange=renderQuestions;$('#classmate-search').oninput=e=>renderClassmates(e.target.value);$('#open-question').onclick=()=>openModal($('#question-modal'));$$('[data-close-modal]').forEach(b=>b.onclick=closeModals);$$('.modal-backdrop').forEach(m=>m.onclick=e=>{if(e.target===m)closeModals()});document.onkeydown=e=>{if(e.key==='Escape')closeModals()};
$('#question-form').onsubmit=e=>{e.preventDefault();const title=$('#question-title').value.trim(),body=$('#question-body').value.trim(),topic=$('#question-topic').value,bounty=Number($('input[name=bounty]:checked').value);questions.unshift({id:Date.now(),topic,title,body,author:'Yuna Tang',initials:'YT',color:'#e7e0ff',bounty,answers:0,time:'Just now',status:'open'});localStorage.setItem('proofly-questions',JSON.stringify(questions));renderQuestions();e.target.reset();closeModals();toast('Question posted','Your sponsored bounty is now live for the class.')};
$('#answer-form').onsubmit=e=>{e.preventDefault();const q=questions.find(x=>x.id===activeAnswerId);q.answers++;localStorage.setItem('proofly-questions',JSON.stringify(questions));setBalance(balance+1);renderQuestions();e.target.reset();closeModals();toast('+1 HELP earned','Your explanation was shared with the class.')};
$('#dismiss-banner').onclick=()=>$('#starter-banner').remove();$('.mobile-menu').onclick=()=>$('.sidebar').classList.toggle('open');$('#wallet-button').onclick=()=>toast('Wallet connected','Sepolia · 0x71f8...a92E');$('#copy-wallet').onclick=()=>{navigator.clipboard?.writeText('0x71f8b4D23c109a92E');toast('Address copied','Wallet address copied to your clipboard.')};
setBalance(balance);renderQuestions();renderClassmates();
