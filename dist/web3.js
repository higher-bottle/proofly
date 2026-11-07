import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.5/+esm";
import { PROOFLY_CONTRACTS } from "./contracts.js";

const ABI = [
  "function mintLearningBadge(string metadataURI,uint256 nonce,uint256 deadline,bytes signature) returns (uint256)",
  "function mintBadge(string badgeId,string metadataURI,uint256 nonce,uint256 deadline,bytes signature) returns (uint256)",
  "function safeTransferFrom(address from,address to,uint256 tokenId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function nextTokenId() view returns (uint256)",
  "event BadgeMinted(address indexed learner,uint256 indexed tokenId,string metadataURI)"
];
const FORUM_ABI = [
  "function submitAnswer(uint256 questionId,bytes32 studentId,uint256 nonce,uint256 deadline,bytes signature) returns (uint256)",
  "function editAnswer(uint256 questionId,bytes32 studentId,uint256 nonce,uint256 deadline,bytes signature)",
  "function finalizeQuestion(uint256 questionId)",
  "function questions(uint256) view returns(address asker,bytes32 askerStudentId,uint96 bounty,bool sponsored,bool finalized,uint64 expiresAt,uint256 answerCount,uint256 selectedAnswerId,address selectedAnswerer)",
  "event AnswerSubmitted(uint256 indexed questionId,uint256 indexed answerId,address indexed answerer)",
  "event AnswerEdited(uint256 indexed questionId,uint256 indexed answerId,address indexed editor)"
];

let provider, signer, account, currentHelpBalanceRaw = 0n, helpTokenDecimals = 18, aggregateHelpBalance = null;
const BADGE_METADATA_FILES = ["./metadata/learning-pioneer.json","./metadata/best-explainer.json","./metadata/curious-mind.json","./metadata/consensus-guide.json","./metadata/security-scout.json","./metadata/course-finisher.json"];
const BADGE_MEMORY_KEY = "proofly-badge-memory";
const HELP_HISTORY_KEY = "proofly-help-history";
const HELP_HISTORY_SEED = [
  {id:"seed-received",type:"transfer",direction:"received",amount:7,title:"HELP received",detail:"Transfer received",address:"0x8A31D8aC6B5E5C9B02198A6D21c2f8445A094Be2",studentAccount:"Noah Williams",timestamp:"2026-10-27T09:18:00+08:00"},
  {id:"seed-earned",type:"earned",direction:"received",amount:1,title:"Explanation reward",detail:"Explained validator selection in Proof of Stake",address:"Proofly rewards",studentAccount:"Proofly",timestamp:"2026-10-26T16:42:00+08:00"},
  {id:"seed-question",type:"spent",direction:"sent",amount:-5,title:"Question reward funded",detail:"Asked: Storage vs memory",address:"Proofly question escrow",studentAccount:"COMP7610 Introduction to Web3 and Blockchain",timestamp:"2026-10-24T11:06:00+08:00"},
  {id:"seed-mint",type:"spent",direction:"sent",amount:-10,title:"Badge minted",detail:"Minted Learning Pioneer",address:PROOFLY_CONTRACTS.badge,studentAccount:"Proofly badge contract",timestamp:"2026-10-21T14:30:00+08:00"}
];
const BADGE_FALLBACK = [
  {id:"learning-pioneer",name:"Learning Pioneer",symbol:"✦",tone:"lime",description:"Mint your first Proofly learning badge."},
  {id:"best-explainer",name:"Best Explainer",symbol:"◆",tone:"violet",description:"Earn five selected best explanations."},
  {id:"curious-mind",name:"Curious Mind",symbol:"?",tone:"peach",description:"Publish ten thoughtful questions."},
  {id:"consensus-guide",name:"Consensus Guide",symbol:"◎",tone:"blue",description:"Excel in consensus topics."},
  {id:"security-scout",name:"Security Scout",symbol:"⌁",tone:"mint",description:"Master smart-contract security."},
  {id:"course-finisher",name:"Course Finisher",symbol:"✓",tone:"gold",description:"Complete every course milestone."}
];
let BADGE_CATALOG=[],badgeCollectionView="all";
const $ = selector => document.querySelector(selector);
const shorten = address => `${address.slice(0, 6)}...${address.slice(-4)}`;
const notify = (title, message, type = "success") => {
  const toast = $("#toast"), icon = toast.querySelector(":scope > span");
  $("#toast-title").textContent = title;
  $("#toast-message").textContent = message;
  toast.classList.toggle("error", type === "error");
  icon.textContent = type === "error" ? "×" : "✓";
  toast.classList.add("show");
  setTimeout(() => { toast.classList.remove("show", "error"); icon.textContent = "✓"; }, 4200);
};
const address = () => PROOFLY_CONTRACTS.badge;
const helpAddress = () => PROOFLY_CONTRACTS.helpToken;
const linkedAddresses = () => { try { return JSON.parse(localStorage.getItem("proofly-linked-addresses") || "[]"); } catch { return []; } };
window.ProoflyWalletState = {
  isConnected: () => Boolean(account),
  isVerified: () => Boolean(account && linkedAddresses().some(item => item.address.toLowerCase() === account.toLowerCase())),
  address: () => account || null
};
window.ProoflyChain = {
  submitExplanation: async (questionId, editing = false) => {
    if (!account || !signer) throw new Error("Connect MetaMask before submitting an on-chain explanation.");
    if (!window.ProoflyWalletState.isVerified()) throw new Error("Verify the connected address before submitting an on-chain explanation.");
    const network = await provider.getNetwork();
    if (network.chainId !== BigInt(PROOFLY_CONTRACTS.chainId)) throw new Error(`Switch MetaMask to Sepolia (chain ${PROOFLY_CONTRACTS.chainId}).`);
    if (!ethers.isAddress(PROOFLY_CONTRACTS.forum)) throw new Error("The Proofly Forum contract is not configured.");
    if (!window.ProoflyAPI) throw new Error("The Proofly demo API is not running.");
    const action = editing ? "edit" : "answer";
    const claim = await window.ProoflyAPI.createForumClaim({ address: account, action, questionId, bounty: 0 });
    const forum = new ethers.Contract(PROOFLY_CONTRACTS.forum, FORUM_ABI, signer);
    const tx = editing
      ? await forum.editAnswer(questionId, claim.studentId, claim.nonce, claim.deadline, claim.signature)
      : await forum.submitAnswer(questionId, claim.studentId, claim.nonce, claim.deadline, claim.signature);
    const receipt = await tx.wait();
    await Promise.all([refreshHelpBalance(), refreshLinkedAddressBalances()]);
    if (!editing) recordHelpActivity({type:"earned",direction:"received",amount:1,title:"On-chain explanation reward",detail:`Sepolia Forum question #${questionId}`,address:PROOFLY_CONTRACTS.forum,studentAccount:"Proofly",txHash:tx.hash});
    let bestAnswer = null, selectionError = null;
    if (!editing) {
      const submitted = receipt.logs.map(log => { try { return forum.interface.parseLog(log); } catch { return null; } }).find(log => log?.name === "AnswerSubmitted");
      if (submitted) {
        try {
          bestAnswer = await window.ProoflyAPI.selectDemoBestAnswer({ address: account, questionId, answerId: submitted.args.answerId.toString() });
          scheduleBestAnswerFinalization(forum, questionId, bestAnswer);
        } catch (error) { selectionError = friendlyError(error); }
      }
    }
    return { txHash: tx.hash, editing, bestAnswer, selectionError };
  }
};

async function checkRecoveredBestAnswerReward() {
  if (!provider || !account || !ethers.isAddress(PROOFLY_CONTRACTS.forum)) return;
  try {
    const forum = new ethers.Contract(PROOFLY_CONTRACTS.forum, FORUM_ABI, provider), question = await forum.questions(1), key = `proofly-celebrated-finalization-v2-${PROOFLY_CONTRACTS.forum.toLowerCase()}-1-${account.toLowerCase()}`, replay = new URLSearchParams(location.search).get("replayReward") === "1";
    if (question.finalized && question.selectedAnswerer.toLowerCase() === account.toLowerCase() && (!localStorage.getItem(key) || replay)) {
      localStorage.setItem(key,"1");
      if(replay)history.replaceState({},"",location.pathname);
      playBestAnswerRewardVisual(Number(ethers.formatEther(question.bounty)));
    }
  } catch {}
}

function playBestAnswerRewardVisual(amount) {
  const value = $("#top-balance"), target = Number(String(value.textContent).replace(/,/g,""));
  if (!Number.isFinite(target)) { window.launchProoflyRewardCelebration?.(amount); return; }
  const start = Math.max(0,target-amount), started = performance.now(), duration = 1300;
  value.classList.add("help-balance-counting");
  const frame = now => { const progress=Math.min(1,(now-started)/duration),eased=1-Math.pow(1-progress,3),current=start+(target-start)*eased;value.textContent=current.toLocaleString(undefined,{maximumFractionDigits:1});if(progress<1)requestAnimationFrame(frame);else{value.textContent=target.toLocaleString(undefined,{maximumFractionDigits:2});value.classList.remove("help-balance-counting");} };
  requestAnimationFrame(frame);setTimeout(()=>window.launchProoflyRewardCelebration?.(amount),520);
}

function scheduleBestAnswerFinalization(forum, questionId, selection) {
  const waitMs = Math.max(1000, selection.expiresAt * 1000 - Date.now() + 12000);
  notify("Maya Chen selected your answer", `${selection.bounty} HELP is scheduled for release when the demo question expires. This selection is a real Sepolia transaction from the demo asker.`, "success");
  setTimeout(async () => {
    try {
      notify("Demo question expired", "Confirm the finalization transaction in MetaMask to receive the best-answer reward.");
      const tx = await forum.finalizeQuestion(questionId); await tx.wait();
      await Promise.all([refreshHelpBalance(), refreshLinkedAddressBalances()]);
      recordHelpActivity({type:"earned",direction:"received",amount:Number(selection.bounty),title:"On-chain best-answer reward",detail:`Finalized Sepolia Forum question #${questionId}`,address:PROOFLY_CONTRACTS.forum,studentAccount:"Proofly",txHash:tx.hash});
      if(window.launchProoflyRewardCelebration)playBestAnswerRewardVisual(Number(selection.bounty));else notify("Best-answer reward received", `${selection.bounty} HELP was minted on Sepolia. The connected address balance has been refreshed.`);
    } catch (error) { notify("Finalization not completed", friendlyError(error), "error"); }
  }, waitMs);
}
async function refreshBackendState(){if(!window.ProoflyAPI)return;try{const addressPayload=await window.ProoflyAPI.getAddresses();localStorage.setItem("proofly-linked-addresses",JSON.stringify(addressPayload.addresses||[]));renderLinkedAddresses();await renderBadgeLibraries();}catch(error){notify("Could not refresh addresses",friendlyError(error),"error");}try{const eligibilityPayload=await window.ProoflyAPI.getBadgeEligibility();for(const badge of eligibilityPayload.badges||[])BADGE_PROGRESS[badge.badgeId]=Number(badge.progress);await renderBadgeLibraries();}catch{}}
const badgeMemory = () => { try { return JSON.parse(localStorage.getItem(BADGE_MEMORY_KEY)||"{}"); } catch { return {}; } };
const saveBadgeMemory = memory => localStorage.setItem(BADGE_MEMORY_KEY,JSON.stringify(memory));
const BADGE_PROGRESS = {"learning-pioneer":1,"best-explainer":3,"curious-mind":4,"consensus-guide":5,"security-scout":2,"course-finisher":7};
async function loadBadgeCatalog(){if(BADGE_CATALOG.length)return BADGE_CATALOG;BADGE_CATALOG=await Promise.all(BADGE_METADATA_FILES.map(async(file,index)=>{try{const metadata=await fetch(file).then(response=>{if(!response.ok)throw new Error("Metadata unavailable");return response.json();});return{id:metadata.id,name:metadata.name,description:metadata.description,image:metadata.image,symbol:metadata.appearance?.symbol||BADGE_FALLBACK[index].symbol,tone:metadata.appearance?.tone||BADGE_FALLBACK[index].tone,eligibility:metadata.eligibility||{threshold:1,label:"Complete requirement"},metadataUrl:new URL(file,window.location.href).href};}catch{return{...BADGE_FALLBACK[index],eligibility:{threshold:1,label:"Complete requirement"},metadataUrl:new URL(file,window.location.href).href};}}));return BADGE_CATALOG;}
const contract = () => {
  if (!signer) throw new Error("Connect your wallet first.");
  if (!ethers.isAddress(address())) throw new Error("The Proofly badge contract is not configured in this build.");
  return new ethers.Contract(address(), ABI, signer);
};
const friendlyError = error => error?.shortMessage || error?.reason || error?.message || "Transaction failed.";
const getHelpHistory = () => { try { const stored=JSON.parse(localStorage.getItem(HELP_HISTORY_KEY)||"null"); return Array.isArray(stored)?stored:HELP_HISTORY_SEED; } catch { return HELP_HISTORY_SEED; } };
let helpHistoryFilter="all";
const localDateValue = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
function selectedWalletRange(){const startValue=$("#wallet-range-start")?.value,endValue=$("#wallet-range-end")?.value,start=startValue?new Date(`${startValue}T00:00:00`):new Date(0),end=endValue?new Date(`${endValue}T23:59:59.999`):new Date();return start<=end?{start,end}:{start:end,end:start};}
function recordHelpActivity(entry) { const history=getHelpHistory();history.unshift({id:crypto.randomUUID(),timestamp:new Date().toISOString(),...entry});localStorage.setItem(HELP_HISTORY_KEY,JSON.stringify(history));renderHelpHistory();renderHelpDashboard(); }
window.recordHelpActivity=recordHelpActivity;
const historyIcon = item => item.type==="earned"?"＋":item.type==="spent"?"−":item.direction==="received"?"↓":"↑";
function renderHelpHistory() {
  const list=$("#help-history-list"),{start,end}=selectedWalletRange(),history=getHelpHistory().filter(item=>{const time=new Date(item.timestamp);return (helpHistoryFilter==="all"||item.type===helpHistoryFilter)&&time>=start&&time<=end;}).sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  list.innerHTML=history.length?history.map(item=>{const date=new Date(item.timestamp),incoming=Number(item.amount)>0,amount=`${incoming?"+":"−"}${Math.abs(Number(item.amount)).toLocaleString(undefined,{maximumFractionDigits:2})} HELP`,addressLabel=item.address?.startsWith("0x")?shorten(item.address):item.address;return `<article class="history-row ${incoming?'credit':'debit'}"><span class="history-kind">${historyIcon(item)}</span><div class="history-activity"><strong>${item.title}</strong><small>${item.detail}</small></div><div class="history-party"><strong>${addressLabel||'—'}</strong><small>${item.studentAccount||'Unknown student account'}</small></div><time datetime="${item.timestamp}" title="${date.toLocaleString()}">${date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}<small>${date.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</small></time><strong class="history-amount">${amount}</strong></article>`}).join(""):'<div class="history-empty">No HELP activity matches this filter.</div>';
}

function renderHelpDashboard() {
  const period=$("#balance-trend-period")?.value||"day",history=getHelpHistory(),daysPerPeriod=period==="day"?1:7,rangeSelection=selectedWalletRange(),start=new Date(rangeSelection.start),end=new Date(rangeSelection.end),rangeDays=Math.max(1,Math.floor((end-start)/86400000)+1),periods=Math.max(1,Math.ceil(rangeDays/daysPerPeriod));
  const buckets=Array.from({length:periods},(_,index)=>{const bucketStart=new Date(start);bucketStart.setDate(start.getDate()+index*daysPerPeriod);const bucketEnd=new Date(bucketStart);bucketEnd.setDate(bucketStart.getDate()+daysPerPeriod-1);bucketEnd.setHours(23,59,59,999);if(bucketEnd>end)bucketEnd.setTime(end.getTime());return{start:bucketStart,end:bucketEnd,change:0};});
  history.forEach(item=>{const time=new Date(item.timestamp);const bucket=buckets.find(entry=>time>=entry.start&&time<=entry.end);if(bucket)bucket.change+=Number(item.amount)||0;});
  const current=aggregateHelpBalance??Number(localStorage.getItem("proofly-balance")||28),now=new Date(),changesSinceStart=history.filter(item=>{const time=new Date(item.timestamp);return time>=start&&time<=now;}).reduce((sum,item)=>sum+(Number(item.amount)||0),0);let running=current-changesSinceStart;const values=buckets.map(bucket=>(running+=bucket.change)),selectedActivity=history.filter(item=>{const time=new Date(item.timestamp);return time>=start&&time<=end;}),earned=selectedActivity.reduce((sum,item)=>sum+Math.max(0,Number(item.amount)||0),0),spent=selectedActivity.reduce((sum,item)=>sum+Math.abs(Math.min(0,Number(item.amount)||0)),0);
  $("#help-earned-rate").textContent=earned.toLocaleString(undefined,{maximumFractionDigits:2});$("#help-spent-rate").textContent=spent.toLocaleString(undefined,{maximumFractionDigits:2});
  const svg=$("#help-balance-chart"),width=560,height=240,left=42,right=8,top=16,bottom=50,rawMin=Math.min(0,...values),rawMax=Math.max(0,...values),min=rawMin===rawMax?-1:rawMin,max=rawMin===rawMax?1:rawMax,chartRange=max-min,zeroY=top+(max*(height-top-bottom)/chartRange),zeroOffset=Math.max(0,Math.min(100,(zeroY-top)/(height-top-bottom)*100)),points=values.map((value,index)=>({x:left+index*(width-left-right)/Math.max(1,values.length-1),y:top+(max-value)*(height-top-bottom)/chartRange,value})),path=points.map((point,index)=>`${index?'L':'M'}${point.x},${point.y}`).join(" ");
  svg.innerHTML=`<defs><linearGradient id="help-area-gradient" x1="0" y1="${top}" x2="0" y2="${height-bottom}" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#c7f164" stop-opacity=".28"/><stop offset="${zeroOffset}%" stop-color="#c7f164" stop-opacity=".16"/><stop offset="${zeroOffset}%" stop-color="#eb6960" stop-opacity=".18"/><stop offset="100%" stop-color="#eb6960" stop-opacity=".32"/></linearGradient><linearGradient id="help-line-gradient" x1="0" y1="${top}" x2="0" y2="${height-bottom}" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#6f9631"/><stop offset="${zeroOffset}%" stop-color="#6f9631"/><stop offset="${zeroOffset}%" stop-color="#c94f49"/><stop offset="100%" stop-color="#c94f49"/></linearGradient></defs><line x1="${left}" y1="${height-bottom}" x2="${width-right}" y2="${height-bottom}" class="help-chart-axis"/><line x1="${left}" y1="${zeroY}" x2="${width-right}" y2="${zeroY}" class="help-chart-zero"/><text x="${left-8}" y="${zeroY+3}" text-anchor="end" class="help-zero-label">0</text><path d="${path} L${points.at(-1).x},${zeroY} L${points[0].x},${zeroY} Z" class="help-chart-area"/><path d="${path}" class="help-chart-line"/>${points.map((point,index)=>{const label=buckets[index].end.toLocaleDateString(undefined,{month:'short',day:'numeric'}),tooltip=`${label}: ${point.value.toLocaleString(undefined,{maximumFractionDigits:1})} HELP`;return `<circle cx="${point.x}" cy="${point.y}" r="4" class="help-chart-point${point.value<0?' negative':''} interactive-chart-point" tabindex="0" aria-label="${tooltip}" data-tooltip="${tooltip}"/>${(points.length<=14||index%Math.ceil(points.length/10)===0||index===points.length-1)?`<text x="${point.x}" y="${height-10}" text-anchor="middle">${label}</text>`:''}${index===points.length-1?`<text x="${point.x-5}" y="${point.y-9}" text-anchor="end" class="help-chart-value">${point.value.toLocaleString(undefined,{maximumFractionDigits:1})} H</text>`:''}`}).join("")}`;
}

function renderLinkedAddresses() {
  const addresses = linkedAddresses(), list = $("#linked-address-list"), destination = $("#help-transfer-destination"), normalizedAccount = account?.toLowerCase();
  list.innerHTML = addresses.length ? addresses.map(item => `<div data-linked-address="${item.address}"><span class="status-dot"></span><span><strong>${shorten(item.address)}</strong><small>${item.address.toLowerCase()===normalizedAccount?'Current MetaMask address':'Verified address'}</small></span><span class="linked-address-meta"><b class="linked-help-balance">${provider?'Loading…':'— HELP'}</b><em>Permanent</em></span></div>`).join("") : '<div class="linked-empty">No verified addresses have been appended yet.</div>';
  const destinations = addresses.filter(item => item.address.toLowerCase() !== normalizedAccount);
  destination.innerHTML = destinations.length ? '<option value="">Select a verified address</option>' + destinations.map(item => `<option value="${item.address}">${shorten(item.address)}</option>`).join("") : '<option value="">Add another verified address first</option>';
  $("#help-transfer-source").textContent = account ? `${shorten(account)}${addresses.some(item=>item.address.toLowerCase()===normalizedAccount)?' · verified':' · not yet verified'}` : "Not connected";
  $("#add-current-address").disabled = !account || addresses.some(item => item.address.toLowerCase() === normalizedAccount);
  $("#verified-address-count").textContent = addresses.length;
  refreshLinkedAddressBalances();
}

async function refreshLinkedAddressBalances() {
  const rows=[...document.querySelectorAll("[data-linked-address]")];
  if(!rows.length){aggregateHelpBalance=0;$("#lab-help-available").textContent="0";renderHelpDashboard();return;}
  if(!provider||!ethers.isAddress(helpAddress())){aggregateHelpBalance=null;$("#lab-help-available").textContent="—";rows.forEach(row=>row.querySelector(".linked-help-balance").textContent="— HELP");renderHelpDashboard();return;}
  try {
    const token=new ethers.Contract(helpAddress(),["function balanceOf(address) view returns (uint256)","function decimals() view returns (uint8)"],provider),decimals=await token.decimals(),balances=await Promise.all(rows.map(async row=>{const output=row.querySelector(".linked-help-balance");try{const raw=await token.balanceOf(row.dataset.linkedAddress),formatted=Number(ethers.formatUnits(raw,decimals));output.textContent=`${formatted.toLocaleString(undefined,{maximumFractionDigits:2})} HELP`;return formatted;}catch{output.textContent="Unavailable";return 0;}}));aggregateHelpBalance=balances.reduce((sum,value)=>sum+value,0);$("#lab-help-available").textContent=aggregateHelpBalance.toLocaleString(undefined,{maximumFractionDigits:2});renderHelpDashboard();
  } catch { aggregateHelpBalance=null;$("#lab-help-available").textContent="—";rows.forEach(row=>row.querySelector(".linked-help-balance").textContent="Unavailable");renderHelpDashboard(); }
}

function badgeCard(badge,count=0,tokenId="",showMint=false,currentWalletBadges=new Set()) {
  const progress=BADGE_PROGRESS[badge.id]||0,threshold=Number(badge.eligibility?.threshold||1),eligible=progress>=threshold,verified=account&&linkedAddresses().some(item=>item.address.toLowerCase()===account.toLowerCase()),alreadyMinted=currentWalletBadges.has(badge.id);
  const buttonLabel=alreadyMinted?"Minted on this address":!eligible?`${progress} / ${threshold} · ${badge.eligibility?.label||"requirement"}`:!verified?"Connect verified address":"Mint badge";
  const action=showMint?`<button class="badge-mint-action" data-mint-badge="${badge.id}" ${eligible&&verified&&!alreadyMinted?"":"disabled"}>${buttonLabel}</button>`:"";
  return `<article class="badge-card ${badge.tone} ${count?'owned':''} ${showMint&&eligible?'eligible':''}"><div class="badge-art"><span>PROOFLY</span><strong>${badge.symbol}</strong><small>ACHIEVEMENT</small></div><div><span class="badge-owned-count">${count} owned</span><h3>${badge.name}${tokenId?` #${tokenId}`:""}</h3><p>${badge.description}</p>${action}</div></article>`;
}

async function syncCurrentAddressBadges(nextId=null){
  if(!provider||!account||!ethers.isAddress(address()))return;
  const verified=linkedAddresses().some(item=>item.address.toLowerCase()===account.toLowerCase());if(!verified)return;
  const catalog=await loadBadgeCatalog(),badge=new ethers.Contract(address(),ABI,provider),end=nextId??await badge.nextTokenId(),records=[];
  for(let id=1n;id<end;id++){try{const owner=await badge.ownerOf(id);if(owner.toLowerCase()!==account.toLowerCase())continue;let uri="";try{uri=await badge.tokenURI(id);}catch{}const normalized=uri.toLowerCase(),matched=catalog.find(item=>normalized.includes(item.id))||catalog[0];records.push({tokenId:id.toString(),badgeId:matched.id,metadataURI:uri||matched.metadataUrl,refreshedAt:new Date().toISOString()});}catch{}}
  const memory=badgeMemory();memory[account.toLowerCase()]=records;saveBadgeMemory(memory);
}

async function renderBadgeLibraries(nextId = null) {
  const ownedLibrary=$("#owned-badge-library"),available=$("#available-badge-library"),summary=$("#owned-badge-summary"),catalog=await loadBadgeCatalog();
  try{await syncCurrentAddressBadges(nextId);}catch{}
  const verified=new Set(linkedAddresses().map(item=>item.address.toLowerCase())),memory=badgeMemory(),owned=[...verified].flatMap(wallet=>(memory[wallet]||[]).map(record=>({...record,wallet}))),counts=owned.reduce((map,item)=>(map[item.badgeId]=(map[item.badgeId]||0)+1,map),{});
  const currentWalletBadges=new Set(account?(memory[account.toLowerCase()]||[]).map(item=>item.badgeId):[]);
  ownedLibrary.innerHTML=owned.length?owned.map(item=>badgeCard(catalog.find(badge=>badge.id===item.badgeId)||catalog[0],1,item.tokenId)).join(""):'<div class="badge-empty"><strong>No badges saved for this student account yet</strong><span>Switch to a verified MetaMask address to refresh and append its badges.</span></div>';
  summary.textContent=owned.length?`${owned.length} badge${owned.length===1?'':'s'} remembered across ${Object.keys(memory).filter(wallet=>verified.has(wallet)).length} verified address${verified.size===1?'':'es'}`:account?'No badges found for the connected verified address':'Connect a verified address to refresh its badges';
  const mintable=catalog.filter(badge=>(BADGE_PROGRESS[badge.id]||0)>=Number(badge.eligibility?.threshold||1)),visible=badgeCollectionView==="mintable"?mintable:catalog;
  $("#all-badge-count").textContent=catalog.length;$("#mintable-badge-count").textContent=mintable.length;
  available.innerHTML=visible.length?visible.map(badge=>badgeCard(badge,counts[badge.id]||0,"",true,currentWalletBadges)).join(""):'<div class="badge-empty"><strong>No badges are ready to mint yet</strong><span>Keep learning to complete another achievement requirement.</span></div>';
}

async function refreshHelpBalance() {
  const value = $("#top-balance"), pill = $("#wallet-help-balance");
  value.textContent = "—";
  currentHelpBalanceRaw = 0n; helpTokenDecimals = 18;
  $("#help-transfer-available").textContent = "— HELP";
  if (!account) { pill.title = "Connect a wallet to load its HELP balance"; return; }
  if (!ethers.isAddress(helpAddress())) { pill.title = "The HELP token contract is not configured in this build"; return; }
  value.textContent = "…";
  pill.title = `Loading HELP for ${account}`;
  try {
    const token = new ethers.Contract(helpAddress(), ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"], provider), [rawBalance, decimals] = await Promise.all([token.balanceOf(account), token.decimals()]), formatted = Number(ethers.formatUnits(rawBalance, decimals)), display = formatted.toLocaleString(undefined, { maximumFractionDigits: 2 });
    currentHelpBalanceRaw = rawBalance; helpTokenDecimals = Number(decimals);
    value.textContent = display;
    $("#help-transfer-available").textContent = `${display} HELP`;
    pill.title = `HELP balance for ${account}`;
  } catch {
    value.textContent = "—";
    pill.title = "Could not read HELP from the saved contract";
  }
}

async function refreshNftCount() {
  const value = $("#lab-nft-minted"); value.textContent = "—";
  if (!provider || !ethers.isAddress(address())) { renderBadgeLibraries(); return; }
  value.textContent = "…";
  try { const nextId = await new ethers.Contract(address(), ["function nextTokenId() view returns (uint256)"], provider).nextTokenId(); value.textContent = (nextId - 1n).toString(); await renderBadgeLibraries(nextId); }
  catch { value.textContent = "—"; renderBadgeLibraries(); }
}

const refreshContractStats = () => Promise.all([refreshHelpBalance(), refreshNftCount()]);

async function showConnectedWallet(selectedAccount) {
  provider = new ethers.BrowserProvider(window.ethereum);
  signer = await provider.getSigner(selectedAccount);
  account = await signer.getAddress();
  const network = await provider.getNetwork(), walletButton = $("#wallet-button");
  $("#web3-status .status-dot").classList.remove("offline");
  $("#web3-wallet-summary").innerHTML = `<strong>${shorten(account)} connected</strong><small>Chain ID ${network.chainId.toString()} · transactions require wallet confirmation</small>`;
  $("#web3-connect").textContent = shorten(account);
  $("#nft-wallet-label").textContent = `${shorten(account)} connected`;
  $("#nft-view .nft-account-status").classList.add("connected");
  walletButton.classList.add("connected");
  walletButton.querySelector("span:last-child").textContent = shorten(account);
  walletButton.setAttribute("aria-label", `Wallet ${account} connected`);
  renderLinkedAddresses();
  await refreshContractStats();
  await checkRecoveredBestAnswerReward();
  window.dispatchEvent(new CustomEvent("proofly:wallet-state", { detail: { connected: true, address: account, verified: window.ProoflyWalletState.isVerified() } }));
  return network;
}

function showDisconnectedWallet() {
  provider = signer = account = undefined;
  const walletButton = $("#wallet-button");
  walletButton.classList.remove("connected");
  walletButton.querySelector("span:last-child").textContent = "Not connected";
  walletButton.setAttribute("aria-label", "Connect wallet");
  $("#web3-connect").textContent = "Connect wallet";
  $("#nft-wallet-label").textContent = "Wallet not connected";
  $("#nft-view .nft-account-status").classList.remove("connected");
  $("#web3-status .status-dot").classList.add("offline");
  $("#web3-wallet-summary").innerHTML = '<strong>Wallet not connected</strong><small>Connect MetaMask on localhost or the hosted site.</small>';
  renderLinkedAddresses();
  refreshContractStats();
  window.dispatchEvent(new CustomEvent("proofly:wallet-state", { detail: { connected: false, address: null, verified: false } }));
}

async function connectWallet() {
  if (!window.ethereum) throw new Error("MetaMask was not found. Install it or open this page in a wallet-enabled browser.");
  const requestedAccounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const network = await showConnectedWallet(requestedAccounts[0]);
  notify("Wallet connected", `Connected to chain ${network.chainId.toString()}.`);
}

async function withTransaction(button, action) {
  const old = button.textContent;
  button.disabled = true; button.textContent = "Waiting for wallet…";
  try { await action(); } catch (error) { notify("Transaction not completed", friendlyError(error), "error"); }
  finally { button.disabled = false; button.textContent = old; }
}

$("#web3-connect").addEventListener("click", () => connectWallet().catch(error => notify("Could not connect", friendlyError(error), "error")));
$("#wallet-button").onclick = () => window.activateView("token");
$("#add-current-address").addEventListener("click", async event => withTransaction(event.currentTarget, async () => {
  if (!account || !signer) throw new Error("Connect the MetaMask address you want to append.");
  const existing = linkedAddresses();
  if (existing.some(item => item.address.toLowerCase() === account.toLowerCase())) throw new Error("This address is already verified.");
  if(!window.ProoflyAPI)throw new Error("The Proofly demo API is not running.");const challenge=await window.ProoflyAPI.createWalletNonce(account),signature=await signer.signMessage(challenge.message),verification=await window.ProoflyAPI.verifyWallet({address:account,nonce:challenge.nonce,signature});if(!verification.verified||!Array.isArray(verification.addresses)||!verification.addresses.some(item=>item.address.toLowerCase()===account.toLowerCase()))throw new Error("The server did not confirm this address in the student wallet list.");localStorage.setItem("proofly-linked-addresses",JSON.stringify(verification.addresses));renderLinkedAddresses();await renderBadgeLibraries();notify("Address verified", `${shorten(account)} was permanently appended to this student account.`);
}));
$("#help-transfer-max").addEventListener("click", () => { $("#help-transfer-amount").value = currentHelpBalanceRaw ? ethers.formatUnits(currentHelpBalanceRaw, helpTokenDecimals) : ""; });
$("#buy-help-amount").addEventListener("input", event => {
  const eth = Number(event.target.value) || 0;
  $("#buy-help-preview").textContent = (eth * 100).toLocaleString(undefined,{maximumFractionDigits:4});
});
$("#buy-help").addEventListener("click", event => withTransaction(event.currentTarget, async () => {
  if (!account || !signer) throw new Error("Connect the MetaMask address that will receive HELP.");
  if (!ethers.isAddress(helpAddress())) throw new Error("The HELP token contract is not configured in this build.");
  const amountText = $("#buy-help-amount").value.trim();
  if (!amountText || Number(amountText) <= 0) throw new Error("Enter a positive ETH amount.");
  const value = ethers.parseEther(amountText), token = new ethers.Contract(helpAddress(), ["function buyHelp() payable returns (uint256)"], signer);
  const tx = await token.buyHelp({value});
  notify("HELP purchase submitted", "Buying " + (Number(amountText)*100).toLocaleString(undefined,{maximumFractionDigits:4}) + " HELP. Waiting for confirmation…");
  await tx.wait();
  const received = Number(amountText) * 100;
  recordHelpActivity({type:"earned",direction:"received",amount:received,title:"HELP purchased",detail:"Purchased with " + amountText + " ETH · does not expire",address:helpAddress(),studentAccount:"Proofly HELP contract",txHash:tx.hash});
  $("#buy-help-amount").value=""; $("#buy-help-preview").textContent="0";
  await Promise.all([refreshHelpBalance(),refreshLinkedAddressBalances()]);
  notify("HELP purchased", received.toLocaleString(undefined,{maximumFractionDigits:4}) + " HELP is now available in " + shorten(account) + ".");
}));
$("#transfer-help").addEventListener("click", event => withTransaction(event.currentTarget, async () => {
  if (!account || !signer) throw new Error("Connect the source address in MetaMask first.");
  const verified = linkedAddresses(), sourceVerified = verified.some(item=>item.address.toLowerCase()===account.toLowerCase()), destination = $("#help-transfer-destination").value, amountText = $("#help-transfer-amount").value.trim();
  if (!sourceVerified) throw new Error("Verify the current MetaMask address before transferring HELP.");
  if (!verified.some(item=>item.address.toLowerCase()===destination.toLowerCase()) || destination.toLowerCase()===account.toLowerCase()) throw new Error("Choose another verified address from this student account.");
  if (!amountText || Number(amountText)<=0) throw new Error("Enter a positive HELP amount.");
  if (!ethers.isAddress(helpAddress())) throw new Error("The HELP token contract is not configured in this build.");
  const amount = ethers.parseUnits(amountText, helpTokenDecimals); if (amount > currentHelpBalanceRaw) throw new Error("The amount cannot exceed the current address's HELP balance.");
  const token = new ethers.Contract(helpAddress(), ["function transfer(address,uint256) returns (bool)"], signer), gasLimit = await token.transfer.estimateGas(destination, amount), feeData = await provider.getFeeData(), gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
  if (!gasPrice) throw new Error("The network did not provide a gas price.");
  const nativeBalance = await provider.getBalance(account); if (nativeBalance < gasLimit * gasPrice) throw new Error("The current address does not have enough native ETH to pay the estimated gas fee.");
  const tx = await token.transfer(destination, amount); notify("HELP transfer submitted", `Sending ${amountText} HELP to ${shorten(destination)}.`); await tx.wait(); recordHelpActivity({type:"transfer",direction:"sent",amount:-Number(amountText),title:"HELP transferred",detail:"Transfer between your verified addresses",address:destination,studentAccount:"Yuna Tang",txHash:tx.hash}); $("#help-transfer-amount").value=""; await Promise.all([refreshHelpBalance(),refreshLinkedAddressBalances()]); notify("HELP transferred", `${amountText} HELP was sent to ${shorten(destination)}.`);
}));
document.querySelectorAll("[data-history-filter]").forEach(button=>button.addEventListener("click",()=>{document.querySelectorAll("[data-history-filter]").forEach(item=>item.classList.toggle("active",item===button));helpHistoryFilter=button.dataset.historyFilter;renderHelpHistory();}));
$("#balance-trend-period").addEventListener("change",renderHelpDashboard);
const rangePicker=$(".dmc-range-picker"),rangePanel=$("#wallet-range-panel"),rangeTrigger=$("#wallet-range-trigger");function updateRangeSummary(){const{start,end}=selectedWalletRange();$("#wallet-range-summary").textContent=`${start.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})} – ${end.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`;}rangeTrigger.addEventListener("click",event=>{event.stopPropagation();const open=!rangePanel.classList.contains("open");rangePanel.classList.toggle("open",open);rangeTrigger.setAttribute("aria-expanded",String(open));});$("#apply-wallet-range").addEventListener("click",()=>{updateRangeSummary();renderHelpDashboard();renderHelpHistory();rangePanel.classList.remove("open");rangeTrigger.setAttribute("aria-expanded","false");});document.addEventListener("click",event=>{if(!event.target.closest(".dmc-range-picker")){rangePanel.classList.remove("open");rangeTrigger.setAttribute("aria-expanded","false");}});
$("#available-badge-library").addEventListener("click", async event => {
  const button=event.target.closest("[data-mint-badge]");if(!button)return;
  await withTransaction(button,async()=>{const catalog=await loadBadgeCatalog(),badge=catalog.find(item=>item.id===button.dataset.mintBadge);if(!badge)throw new Error("Badge metadata is unavailable.");const progress=BADGE_PROGRESS[badge.id]||0;if(progress<Number(badge.eligibility?.threshold||1))throw new Error("This achievement requirement has not been met yet.");if(!window.ProoflyAPI)throw new Error("The Proofly demo API is not running.");const claim=await window.ProoflyAPI.createBadgeClaim({address:account,badgeId:badge.id,metadataURI:badge.metadataUrl});const tx=await contract().mintBadge(badge.id,badge.metadataUrl,claim.nonce,claim.deadline,claim.signature);notify("Mint submitted",`Minting ${badge.name}. Waiting for blockchain confirmation…`);const receipt=await tx.wait(),parsed=receipt.logs.map(log=>{try{return contract().interface.parseLog(log);}catch{return null;}}).find(log=>log?.name==="BadgeMinted"),tokenId=parsed?parsed.args.tokenId.toString():"new";await refreshNftCount();notify("NFT minted",`${badge.name} #${tokenId} now belongs to ${shorten(account)}.`);});
});
document.querySelectorAll("[data-badge-view]").forEach(button=>button.addEventListener("click",()=>{badgeCollectionView=button.dataset.badgeView;document.querySelectorAll("[data-badge-view]").forEach(item=>{const active=item===button;item.classList.toggle("active",active);item.setAttribute("aria-selected",String(active));});renderBadgeLibraries();}));

const walletRangeEnd=new Date(),walletRangeStart=new Date();walletRangeStart.setDate(walletRangeEnd.getDate()-29);$("#wallet-range-start").value=localDateValue(walletRangeStart);$("#wallet-range-end").value=localDateValue(walletRangeEnd);
updateRangeSummary();
renderLinkedAddresses();
renderBadgeLibraries();
refreshBackendState();
renderHelpHistory();
renderHelpDashboard();
showDisconnectedWallet();
if (window.ethereum) window.ethereum.request({ method: "eth_accounts" }).then(accounts => accounts.length ? showConnectedWallet(accounts[0]) : showDisconnectedWallet()).catch(showDisconnectedWallet);
window.ethereum?.on?.("accountsChanged", accounts => {
  if (!accounts.length) { showDisconnectedWallet(); return; }
  const nextAccount = ethers.getAddress(accounts[0]);
  if (account && nextAccount.toLowerCase() !== account.toLowerCase()) {
    const previousAccount = account;
    showDisconnectedWallet();
    notify("Wallet disconnected", `MetaMask changed from ${shorten(previousAccount)} to ${shorten(nextAccount)}. Connect again to authorize the new address in Proofly.`, "error");
    return;
  }
  showConnectedWallet(nextAccount).catch(() => showDisconnectedWallet());
});
window.ethereum?.on?.("chainChanged", () => window.location.reload());
