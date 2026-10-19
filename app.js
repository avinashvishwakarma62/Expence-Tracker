/* Spendly — local-first personal expense tracker */
(() => {
  "use strict";
  const DB_NAME = "spendly-local-db", DB_VERSION = 2;
  const DEFAULT_CATEGORIES = [
    {id:"food",name:"Food & dining",type:"expense",icon:"☕",color:"#28a982",isDefault:true},
    {id:"transport",name:"Transport",type:"expense",icon:"↗",color:"#6e8ce5",isDefault:true},
    {id:"shopping",name:"Shopping",type:"expense",icon:"◇",color:"#e7a34d",isDefault:true},
    {id:"bills",name:"Bills & utilities",type:"expense",icon:"⌁",color:"#9b82db",isDefault:true},
    {id:"health",name:"Health",type:"expense",icon:"✚",color:"#e17a85",isDefault:true},
    {id:"education",name:"Education",type:"expense",icon:"▤",color:"#5aabc8",isDefault:true},
    {id:"entertainment",name:"Entertainment",type:"expense",icon:"♫",color:"#d38bb7",isDefault:true},
    {id:"personal",name:"Personal care",type:"expense",icon:"✦",color:"#c3a45e",isDefault:true},
    {id:"other-expense",name:"Other expense",type:"expense",icon:"•",color:"#8b99aa",isDefault:true},
    {id:"salary",name:"Salary",type:"income",icon:"↙",color:"#28a982",isDefault:true},
    {id:"pocket-money",name:"Pocket money",type:"income",icon:"₹",color:"#6e8ce5",isDefault:true},
    {id:"freelance",name:"Freelance",type:"income",icon:"✧",color:"#e7a34d",isDefault:true},
    {id:"other-income",name:"Other income",type:"income",icon:"＋",color:"#9b82db",isDefault:true}
  ];
  const COLORS = ["#28a982","#6e8ce5","#e7a34d","#9b82db","#e17a85","#5aabc8","#d38bb7","#c3a45e","#8b99aa","#4fbdc0"];
  const $ = (id) => document.getElementById(id);
  const state = { db:null, month:"", page:"dashboard", txType:"expense", settings:{theme:"light",currency:"INR",openingBalance:0}, transactions:[], categories:[], budgets:[], goals:[], recurring:[], cloudClient:null, cloudUser:null, cloudApplying:false, cloudTimer:null, selectedCalendarDate:"" };
  const fmt = (amount, compact=false) => new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:amount%100===0?0:2,notation:compact && Math.abs(amount)>=100000?"compact":"standard"}).format((Number(amount)||0)/100);
  const rupees = (n) => Math.round(Number(n)*100);
  const fromPaise = (n) => (Number(n)||0)/100;
  const id = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const currentMonth = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; };
  state.month = currentMonth();
  const today = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
  const monthLabel = (ym) => { const [y,m]=ym.split("-").map(Number); return new Date(y,m-1,1).toLocaleDateString("en-IN",{month:"long",year:"numeric"}); };
  const dateLabel = (date, opts={day:"numeric",month:"short",year:"numeric"}) => date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-IN",opts) : "—";
  const escapeHtml = (s) => String(s??"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const category = (catId) => state.categories.find(c=>c.id===catId) || {id:catId,name:"Uncategorized",icon:"•",color:"#8b99aa",type:"expense"};
  const monthOf = (date) => String(date||"").slice(0,7);
  const isSelectedMonth = (t) => monthOf(t.date)===state.month;
  const sum = (arr, fn) => arr.reduce((n,x)=>n+fn(x),0);
  const txForMonth = (month=state.month) => state.transactions.filter(t=>monthOf(t.date)===month);
  const income = (arr) => sum(arr.filter(t=>t.type==="income"),t=>t.amount);
  const expenses = (arr) => sum(arr.filter(t=>t.type==="expense"),t=>t.amount);
  const openDB = () => new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{const db=request.result;
      if(!db.objectStoreNames.contains("transactions")){const s=db.createObjectStore("transactions",{keyPath:"id"});s.createIndex("date","date");s.createIndex("type","type");}
      if(!db.objectStoreNames.contains("categories"))db.createObjectStore("categories",{keyPath:"id"});
      if(!db.objectStoreNames.contains("budgets")){const s=db.createObjectStore("budgets",{keyPath:"id"});s.createIndex("month","month");}
      if(!db.objectStoreNames.contains("goals"))db.createObjectStore("goals",{keyPath:"id"});
      if(!db.objectStoreNames.contains("meta"))db.createObjectStore("meta",{keyPath:"key"});
      if(!db.objectStoreNames.contains("recurring")){const s=db.createObjectStore("recurring",{keyPath:"id"});s.createIndex("nextDueDate","nextDueDate");}
    };
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
  const req = (request) => new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  async function getAll(store){return req(state.db.transaction(store,"readonly").objectStore(store).getAll());}
  async function put(store,value){
    return new Promise((resolve,reject)=>{const tx=state.db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>{resolve(value);if(!state.cloudApplying)scheduleCloudPush();};tx.onerror=()=>reject(tx.error||new Error("Could not save data."));tx.onabort=()=>reject(tx.error||new Error("Save was cancelled."));});
  }
  async function del(store,key){
    return new Promise((resolve,reject)=>{const tx=state.db.transaction(store,"readwrite");tx.objectStore(store).delete(key);tx.oncomplete=async()=>{try{if(!state.cloudApplying)await recordTombstone(store,key);resolve();}catch(e){reject(e);}};tx.onerror=()=>reject(tx.error||new Error("Could not delete data."));tx.onabort=()=>reject(tx.error||new Error("Delete was cancelled."));});
  }
  async function clearStore(store){return req(state.db.transaction(store,"readwrite").objectStore(store).clear());}
  async function getMeta(key,fallback){const value=await req(state.db.transaction("meta","readonly").objectStore("meta").get(key));return value?value.value:fallback;}
  async function setMeta(key,value){return put("meta",{key,value});}
  async function refresh(){
    [state.transactions,state.categories,state.budgets,state.goals,state.recurring]=await Promise.all([getAll("transactions"),getAll("categories"),getAll("budgets"),getAll("goals"),getAll("recurring")]);
    state.settings=await getMeta("settings",state.settings);
    if(!state.categories.length){for(const c of DEFAULT_CATEGORIES)await put("categories",c);state.categories=await getAll("categories");}
    if(!$("globalMonth").value)$("globalMonth").value=state.month;
    renderAll();
  }
  function toast(message,type="success"){
    const el=document.createElement("div");el.className=`toast ${type==="error"?"error":""}`;el.innerHTML=`<span class="toast-mark">${type==="error"?"!":"✓"}</span><span>${escapeHtml(message)}</span>`;$("toastRegion").appendChild(el);setTimeout(()=>el.remove(),3400);
  }
  function showModal(modalId){$(modalId).classList.remove("hidden");document.body.style.overflow="hidden";const first=$(modalId).querySelector("input:not([type=hidden]),select");if(first)setTimeout(()=>first.focus(),40);}
  function hideModal(modalId){$(modalId).classList.add("hidden");if(!document.querySelector(".modal-backdrop:not(.hidden)"))document.body.style.overflow="";}
  function setPage(page){
    state.page=page;document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${page}`));
    document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
    const names={dashboard:"Overview",transactions:"Transactions",budgets:"Budgets",analytics:"Analytics",goals:"Savings goals",planner:"Planner & tools",settings:"Settings"};$("pageCrumb").textContent=names[page]||"Overview";
    $("sidebar").classList.remove("open");window.scrollTo({top:0,behavior:"smooth"});renderAll();
  }
  function applyTheme(theme){
    const chosen=theme==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):theme;
    document.body.classList.toggle("dark",chosen==="dark");$("themeToggle").textContent=chosen==="dark"?"☀":"☾";$("themeSelect").value=theme;
    try{localStorage.setItem("spendly-theme",theme);}catch{}
    if(state.settings)state.settings.theme=theme;
  }
  function addCategoryOptions(select,type,includeAll=false){
    const selected=select.value;select.innerHTML=includeAll?'<option value="all">All categories</option>':"";
    state.categories.filter(c=>c.type===type || type==="any").forEach(c=>{const o=document.createElement("option");o.value=c.id;o.textContent=`${c.icon}  ${c.name}`;select.appendChild(o);});
    if([...select.options].some(o=>o.value===selected))select.value=selected;
  }
  function updateCategorySelectors(){
    addCategoryOptions($("txCategory"),state.txType);
    addCategoryOptions($("txCategoryFilter"),"any",true);
    const b=$("budgetName"),old=b.value;b.innerHTML='<option value="all">Overall monthly budget</option>';
    state.categories.filter(c=>c.type==="expense").forEach(c=>{const o=document.createElement("option");o.value=c.id;o.textContent=`${c.icon} ${c.name}`;b.appendChild(o);});if([...b.options].some(o=>o.value===old))b.value=old;
  }
  function renderAll(){
    if(!state.db)return;
    updateCategorySelectors();
    renderDashboard();renderTransactions();renderBudgets();renderAnalytics();renderGoals();renderPlanner();
    if($("openingAmount")&&!$("openingModal").classList.contains("hidden"))$("openingAmount").value=fromPaise(state.settings.openingBalance||0);
  }
  function renderDashboard(){
    const all=state.transactions, monthTx=txForMonth(), inc=income(monthTx),exp=expenses(monthTx),balance=(Number(state.settings.openingBalance)||0)+income(all)-expenses(all),net=inc-exp;
    $("totalBalance").textContent=fmt(balance);$("totalIncome").textContent=fmt(inc);$("totalExpenses").textContent=fmt(exp);$("netFlow").textContent=fmt(net);$("netFlow").classList.toggle("negative",net<0);$("netFlow").classList.toggle("positive",net>=0);
    $("greetingDate").textContent=`YOUR MONEY, AT A GLANCE · ${monthLabel(state.month).toUpperCase()}`;
    const sorted=[...all].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
    const recent=sorted.slice(0,5);$("recentTransactions").innerHTML=recent.map(txRow).join("");$("recentEmpty").classList.toggle("hidden",recent.length>0);
    $("dashboardBudgetList").innerHTML=dashboardBudgets().slice(0,4).map(budgetMini).join("");$("budgetEmpty").classList.toggle("hidden",dashboardBudgets().length>0);
    const categoryTotals=categorySpend(monthTx);const total=expenses(monthTx);$("donutTotal").textContent=fmt(total,true);
    drawDonut($("categoryChart"),categoryTotals.map(x=>({value:x.amount,color:x.color})));renderLegend($("categoryLegend"),categoryTotals.slice(0,5),total);
    $("categoryEmpty").classList.toggle("hidden",total>0);
    $("cashflowEmpty").classList.toggle("hidden",state.transactions.length>0);drawBars($("cashflowChart"),lastSixMonths(),false);
  }
  function txRow(t,withActions=false){
    const c=category(t.categoryId),isIncome=t.type==="income",title=t.note?.trim()||c.name;
    return `<tr><td><div class="transaction-name"><span class="transaction-symbol ${t.type}">${isIncome?"↙":c.icon||"•"}</span><div><div class="transaction-title">${escapeHtml(title)}</div><div class="transaction-subtitle">${isIncome?"Income":"Expense"} · ${escapeHtml(t.paymentMethod||"Other")}</div></div></div></td><td><span class="category-pill"><i style="background:${c.color}"></i>${escapeHtml(c.name)}</span></td>${withActions?`<td>${escapeHtml(t.paymentMethod||"Other")}</td>`:""}<td>${dateLabel(t.date,{day:"numeric",month:"short",year:"numeric"})}</td><td class="align-right ${isIncome?"amount-income":"amount-expense"}">${isIncome?"+":"−"}${fmt(t.amount)}</td>${withActions?`<td><div class="table-actions"><button class="tiny-action" title="Edit" data-edit-tx="${t.id}">✎</button><button class="tiny-action" title="Delete" data-delete-tx="${t.id}">×</button></div></td>`:""}</tr>`;
  }
  function renderTransactions(){
    const q=$("txSearch").value.trim().toLowerCase(),type=$("txTypeFilter").value,cat=$("txCategoryFilter").value,payment=$("txPaymentFilter").value;
    const filtered=state.transactions.filter(t=>(!q||`${t.note||""} ${category(t.categoryId).name} ${t.paymentMethod||""}`.toLowerCase().includes(q))&&(type==="all"||t.type===type)&&(cat==="all"||t.categoryId===cat)&&(payment==="all"||t.paymentMethod===payment)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
    $("transactionsBody").innerHTML=filtered.map(t=>txRow(t,true)).join("");$("transactionsEmpty").classList.toggle("hidden",filtered.length>0);
    $("txCount").textContent=filtered.length;$("txIncome").textContent=fmt(income(filtered));$("txExpenses").textContent=fmt(expenses(filtered));
  }
  function categorySpend(arr){
    const totals={};arr.filter(t=>t.type==="expense").forEach(t=>{const c=category(t.categoryId);if(!totals[t.categoryId])totals[t.categoryId]={id:t.categoryId,name:c.name,icon:c.icon,color:c.color,amount:0};totals[t.categoryId].amount+=t.amount;});
    return Object.values(totals).sort((a,b)=>b.amount-a.amount);
  }
  function renderLegend(el,items,total){
    el.innerHTML=items.length?items.map(x=>`<div class="legend-row"><span class="legend-swatch" style="background:${x.color}"></span><span class="legend-name">${escapeHtml(x.name)}</span><span class="legend-amount">${total?Math.round(x.amount/total*100):0}%</span></div>`).join(""):`<div class="muted-small">No categories yet</div>`;
  }
  function dashboardBudgets(){return state.budgets.filter(b=>b.month===state.month).map(b=>({...b,spent:budgetSpent(b)})).sort((a,b)=>(b.spent/b.limitAmount)-(a.spent/a.limitAmount));}
  function budgetSpent(b){return expenses(txForMonth(b.month).filter(t=>b.categoryId? t.categoryId===b.categoryId:true));}
  function budgetMini(b){
    const c=b.categoryId?category(b.categoryId):{name:"Overall monthly",icon:"◷"};const pct=b.limitAmount?b.spent/b.limitAmount*100:0;const status=pct>=100?"over":pct>=80?"warning":"";
    return `<div class="budget-mini-item"><div class="mini-top"><span>${c.icon||"◷"} ${escapeHtml(c.name)}</span><span>${fmt(b.spent)} / ${fmt(b.limitAmount)}</span></div><div class="progress-track"><div class="progress-fill ${status}" style="width:${Math.min(100,pct)}%"></div></div><div class="mini-bottom"><span>${pct>=100?"Limit exceeded":`${Math.round(pct)}% used`}</span><span>${fmt(Math.max(0,b.limitAmount-b.spent))} left</span></div></div>`;
  }
  function renderBudgets(){
    const budgets=dashboardBudgets(),totalLimit=sum(budgets,b=>b.limitAmount),totalSpent=expenses(txForMonth()),remaining=totalLimit-totalSpent;
    $("budgetSummary").innerHTML=`<div class="summary-card"><span>Total budget limits</span><strong>${fmt(totalLimit)}</strong><small>${budgets.length} budget${budgets.length===1?"":"s"} for ${monthLabel(state.month)}</small></div><div class="summary-card"><span>Total expenses</span><strong>${fmt(totalSpent)}</strong><small>All expense transactions this month</small></div><div class="summary-card"><span>Budget remaining</span><strong class="${remaining<0?"negative":"positive"}">${fmt(remaining)}</strong><small>${remaining<0?"You're over combined limits":"Across your budget limits"}</small></div>`;
    $("budgetCards").innerHTML=budgets.map(b=>{
      const c=b.categoryId?category(b.categoryId):{name:"Overall monthly",icon:"◷",color:"#28a982"};const pct=b.limitAmount?b.spent/b.limitAmount*100:0,status=pct>=100?"over":pct>=80?"warning":"";
      return `<article class="budget-card"><div class="budget-card-head"><div class="budget-category"><span class="budget-icon">${c.icon||"◷"}</span>${escapeHtml(c.name)}</div><div class="budget-card-actions"><button class="tiny-action" title="Edit budget" data-edit-budget="${b.id}">✎</button><button class="tiny-action" title="Delete budget" data-delete-budget="${b.id}">×</button></div></div><div class="budget-big">${fmt(b.spent)} <span style="font-size:11px;color:var(--muted);font-weight:500">/ ${fmt(b.limitAmount)}</span></div><div class="budget-caption">spent of monthly limit</div><div class="budget-progress-label"><span>${Math.round(pct)}% used</span><span>${pct>=100?"Limit exceeded":`${fmt(b.limitAmount-b.spent)} remaining`}</span></div><div class="progress-track"><div class="progress-fill ${status}" style="width:${Math.min(100,pct)}%"></div></div><div class="budget-card-bottom"><span>${monthLabel(state.month)}</span><strong class="${pct>=100?"over-label":""}">${pct>=100?"Over budget":pct>=80?"Approaching limit":"On track"}</strong></div></article>`;
    }).join("");
    $("budgetsEmpty").classList.toggle("hidden",budgets.length>0);
  }
  function lastSixMonths(){
    const [y,m]=state.month.split("-").map(Number);return Array.from({length:6},(_,i)=>{const d=new Date(y,m-1-(5-i),1),ym=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,tx=txForMonth(ym);return {label:d.toLocaleDateString("en-IN",{month:"short"}),income:income(tx),expenses:expenses(tx),month:ym};});
  }
  function renderAnalytics(){
    const mtx=txForMonth(),inc=income(mtx),exp=expenses(mtx),net=inc-exp,allInc=income(state.transactions);
    const prevDate=new Date(Number(state.month.slice(0,4)),Number(state.month.slice(5,7))-2,1),prevMonth=`${prevDate.getFullYear()}-${String(prevDate.getMonth()+1).padStart(2,"0")}`,prevExp=expenses(txForMonth(prevMonth));
    const delta=prevExp?((exp-prevExp)/prevExp*100):null;
    $("analyticsSummary").innerHTML=`<div class="summary-card"><span>Income this month</span><strong class="positive">${fmt(inc)}</strong><small>Money received</small></div><div class="summary-card"><span>Expenses this month</span><strong>${fmt(exp)}</strong><small>${delta===null?"No previous month comparison":`${delta>0?"+":""}${delta.toFixed(1)}% vs previous month`}</small></div><div class="summary-card"><span>Net cash flow</span><strong class="${net<0?"negative":"positive"}">${fmt(net)}</strong><small>${net>=0?"Positive month so far":"Expenses exceed income"}</small></div><div class="summary-card"><span>Savings rate</span><strong>${inc?`${(net/inc*100).toFixed(1)}%`:"—"}</strong><small>Net cash flow / income</small></div>`;
    drawBars($("analyticsCashflowChart"),lastSixMonths(),true);
    const cats=categorySpend(mtx);drawDonut($("analyticsCategoryChart"),cats.map(x=>({value:x.amount,color:x.color})));$("analyticsDonutTotal").textContent=fmt(exp,true);renderLegend($("analyticsCategoryLegend"),cats.slice(0,7),exp);
    const insights=[];
    if(!mtx.length)insights.push(["＋","Ready when you are","Add transactions to unlock personalized spending insights."]);
    else{
      const top=cats[0];if(top)insights.push(["↗","Your top category",`${top.name} accounts for ${Math.round(top.amount/Math.max(exp,1)*100)}% of your expenses (${fmt(top.amount)}).`]);
      if(inc>0)insights.push(["✧","Savings rate",net>=0?`You're keeping ${(net/inc*100).toFixed(1)}% of this month's recorded income after expenses.`:"Your expenses are higher than your recorded income this month. Review your biggest categories."]);
      const overs=dashboardBudgets().filter(b=>b.spent>b.limitAmount);if(overs.length)insights.push(["!","Budget check",`${overs.length} budget${overs.length>1?"s are":" is"} over the limit. Consider adjusting your plan or reviewing recent purchases.`]);
      else if(dashboardBudgets().length)insights.push(["✓","Budget check","No budgets are over their limits based on the transactions recorded so far."]);
      if(prevExp>0)insights.push(["⌁","Month-on-month",`Expenses are ${exp>prevExp?"up":exp<prevExp?"down":"unchanged"} ${Math.abs((exp-prevExp)/prevExp*100).toFixed(1)}% versus last month.`]);
      if(!insights.length)insights.push(["✦","Keep going","The more consistently you track, the more useful these insights become."]);
    }
    $("insightsList").innerHTML=insights.map(x=>`<div class="insight-item"><span class="insight-icon">${x[0]}</span><div><strong>${escapeHtml(x[1])}</strong><p>${escapeHtml(x[2])}</p></div></div>`).join("");
    $("topCategories").innerHTML=cats.length?cats.slice(0,5).map(c=>`<div class="top-cat-row"><div class="top-cat-title"><span class="legend-swatch" style="background:${c.color}"></span><strong>${escapeHtml(c.name)}</strong></div><span class="top-cat-amount">${fmt(c.amount)}</span><div class="top-cat-track"><span style="width:${c.amount/Math.max(cats[0].amount,1)*100}%;background:${c.color}"></span></div></div>`).join(""):'<div class="empty-state compact-empty"><strong>No spending data yet</strong><p>Expenses will appear here once you add them.</p></div>';
  }
  function renderGoals(){
    const saved=sum(state.goals,g=>g.savedAmount||0);$("goalsTotalSaved").textContent=fmt(saved);
    $("goalGrid").innerHTML=state.goals.map(g=>{const pct=g.targetAmount?g.savedAmount/g.targetAmount*100:0;return `<article class="goal-card"><div class="goal-card-head"><span class="goal-emoji">${goalEmoji(g.name)}</span><div class="budget-card-actions"><button class="tiny-action" title="Edit goal" data-edit-goal="${g.id}">✎</button><button class="tiny-action" title="Delete goal" data-delete-goal="${g.id}">×</button></div></div><div class="goal-title">${escapeHtml(g.name)}</div><div class="goal-date">${g.targetDate?`Target · ${dateLabel(g.targetDate,{day:"numeric",month:"short",year:"numeric"})}`:"No target date set"}</div><div class="goal-amounts"><strong>${fmt(g.savedAmount)}</strong><span>of ${fmt(g.targetAmount)}</span></div><div class="progress-track"><div class="progress-fill ${pct>=100?"":" "}" style="width:${Math.min(100,pct)}%"></div></div><div class="goal-progress-label"><span>${Math.min(100,Math.round(pct))}% complete</span><span>${fmt(Math.max(0,g.targetAmount-g.savedAmount))} to go</span></div><div class="goal-card-actions"><button class="primary-button small" data-contribute-goal="${g.id}" ${pct>=100?"disabled":""}>＋ Add savings</button><button class="secondary-button small" data-edit-goal="${g.id}">Edit</button></div></article>`;}).join("");
    $("goalsEmpty").classList.toggle("hidden",state.goals.length>0);
  }
  function goalEmoji(name){const s=name.toLowerCase();if(s.includes("laptop")||s.includes("computer"))return "💻";if(s.includes("trip")||s.includes("travel"))return "✈️";if(s.includes("emergency"))return "🛟";if(s.includes("phone"))return "📱";if(s.includes("bike")||s.includes("car"))return "🚲";return "✧";}
  function drawBars(canvas,rows,large){
    if(!canvas||!canvas.getContext)return;const rect=canvas.getBoundingClientRect();if(rect.width<2)return;const ratio=window.devicePixelRatio||1;canvas.width=Math.floor(rect.width*ratio);canvas.height=Math.floor(rect.height*ratio);const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);
    const cs=getComputedStyle(document.body),muted=cs.getPropertyValue("--muted").trim(),line=cs.getPropertyValue("--line").trim();const pad={l:large?44:35,r:8,t:12,b:26},plotW=w-pad.l-pad.r,plotH=h-pad.t-pad.b;
    const max=Math.max(1,...rows.flatMap(r=>[r.income,r.expenses]));const nice=Math.pow(10,Math.floor(Math.log10(max))),step=Math.max(nice,Math.ceil(max/(large?4:3)/nice)*nice);
    ctx.font="10px system-ui";ctx.textAlign="right";ctx.textBaseline="middle";
    for(let i=0;i<=4;i++){const val=step*i,y=pad.t+plotH-plotH*i/4;ctx.strokeStyle=line;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillStyle=muted;ctx.fillText(shortMoney(val),pad.l-7,y);}
    const group=plotW/Math.max(rows.length,1),barW=Math.min(large?18:22,group*.25);
    rows.forEach((r,i)=>{const cx=pad.l+group*(i+.5);const ih=r.income/(step*4)*plotH,eh=r.expenses/(step*4)*plotH;ctx.fillStyle="#28a982";roundRect(ctx,cx-barW-2,pad.t+plotH-ih,barW,ih,4);ctx.fill();ctx.fillStyle="#aab9cb";roundRect(ctx,cx+2,pad.t+plotH-eh,barW,eh,4);ctx.fill();ctx.fillStyle=muted;ctx.textAlign="center";ctx.textBaseline="top";ctx.fillText(r.label,cx,h-pad.b+9);});
  }
  function roundRect(ctx,x,y,w,h,r){if(h<1)return;const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath();}
  function shortMoney(paise){const n=paise/100;if(n>=10000000)return `₹${(n/10000000).toFixed(1)}Cr`;if(n>=100000)return `₹${(n/100000).toFixed(1)}L`;if(n>=1000)return `₹${(n/1000).toFixed(n>=10000?0:1)}k`;return `₹${Math.round(n)}`;}
  function drawDonut(canvas,items){
    if(!canvas||!canvas.getContext)return;const rect=canvas.getBoundingClientRect();if(rect.width<2)return;const ratio=window.devicePixelRatio||1;canvas.width=Math.floor(rect.width*ratio);canvas.height=Math.floor(rect.height*ratio);const ctx=canvas.getContext("2d");ctx.scale(ratio,ratio);const w=rect.width,h=rect.height,cx=w/2,cy=h/2,r=Math.min(w,h)*.41,thickness=Math.min(w,h)*.15;ctx.clearRect(0,0,w,h);
    const cs=getComputedStyle(document.body),track=cs.getPropertyValue("--surface-3").trim();ctx.beginPath();ctx.strokeStyle=track;ctx.lineWidth=thickness;ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
    const total=sum(items,x=>x.value);if(total<=0)return;let angle=-Math.PI/2;items.forEach(item=>{const sweep=item.value/total*Math.PI*2;ctx.beginPath();ctx.strokeStyle=item.color;ctx.lineWidth=thickness;ctx.lineCap="butt";ctx.arc(cx,cy,r,angle,angle+sweep);ctx.stroke();angle+=sweep;});
  }
  function openTransaction(existing=null){
    state.txType=existing?.type||"expense";$("transactionForm").reset();$("txId").value=existing?.id||"";$("txType").value=state.txType;
    document.querySelectorAll("[data-txtype]").forEach(b=>b.classList.toggle("active",b.dataset.txtype===state.txType));
    updateCategorySelectors();$("txAmount").value=existing?fromPaise(existing.amount):"";$("txCategory").value=existing?.categoryId||state.categories.find(c=>c.type===state.txType)?.id||"";
    $("txDate").value=existing?.date||today();$("txPayment").value=existing?.paymentMethod||"UPI";$("txNote").value=existing?.note||"";
    $("transactionModalTitle").textContent=existing?"Edit transaction":"Add transaction";$("saveTransaction").textContent=existing?"Save changes":"Save transaction";$("txFormError").classList.add("hidden");showModal("transactionModal");
  }
  function openBudget(existing=null){
    $("budgetForm").reset();$("budgetId").value=existing?.id||"";updateCategorySelectors();$("budgetName").value=existing?(existing.categoryId||"all"):"all";$("budgetAmount").value=existing?fromPaise(existing.limitAmount):"";$("budgetModalTitle").textContent=existing?"Edit budget":"Create budget";$("budgetFormError").classList.add("hidden");showModal("budgetModal");
  }
  function openGoal(existing=null){
    $("goalForm").reset();$("goalId").value=existing?.id||"";$("goalName").value=existing?.name||"";$("goalTarget").value=existing?fromPaise(existing.targetAmount):"";$("goalSaved").value=existing?fromPaise(existing.savedAmount):0;$("goalDate").value=existing?.targetDate||"";$("goalModalTitle").textContent=existing?"Edit savings goal":"Create savings goal";$("goalFormError").classList.add("hidden");showModal("goalModal");
  }
  async function saveTransaction(e){
    e.preventDefault();const amount=Number($("txAmount").value),type=$("txType").value,categoryId=$("txCategory").value,date=$("txDate").value;
    const err=$("txFormError");if(!Number.isFinite(amount)||amount<=0){err.textContent="Enter an amount greater than zero.";err.classList.remove("hidden");return;}if(!date||date> "9999-12-31"){err.textContent="Choose a valid transaction date.";err.classList.remove("hidden");return;}
    const existing=state.transactions.find(t=>t.id===$("txId").value);const now=new Date().toISOString();const tx={id:existing?.id||id(),type,amount:rupees(amount),categoryId,date,paymentMethod:$("txPayment").value,note:$("txNote").value.trim(),tags:existing?.tags||[],createdAt:existing?.createdAt||now,updatedAt:now};
    await put("transactions",tx);hideModal("transactionModal");await refresh();toast(existing?"Transaction updated":"Transaction saved");checkBudgetAlerts();
  }
  async function saveBudget(e){
    e.preventDefault();const amount=Number($("budgetAmount").value),cat=$("budgetName").value,err=$("budgetFormError");if(!Number.isFinite(amount)||amount<=0){err.textContent="Enter a budget greater than zero.";err.classList.remove("hidden");return;}
    const existingId=$("budgetId").value,existing=state.budgets.find(b=>b.id===existingId);const duplicate=state.budgets.find(b=>b.month===state.month&&(b.categoryId||null)===(cat==="all"?null:cat)&&b.id!==existingId);
    if(duplicate){err.textContent="A budget for this category and month already exists. Edit the existing budget instead.";err.classList.remove("hidden");return;}
    await put("budgets",{id:existingId||id(),month:state.month,categoryId:cat==="all"?null:cat,limitAmount:rupees(amount),createdAt:existing?.createdAt||new Date().toISOString()});hideModal("budgetModal");await refresh();toast(existing?"Budget updated":"Budget created");checkBudgetAlerts();
  }
  async function saveGoal(e){
    e.preventDefault();const name=$("goalName").value.trim(),target=Number($("goalTarget").value),saved=Number($("goalSaved").value),err=$("goalFormError");
    if(!name||!Number.isFinite(target)||target<=0||!Number.isFinite(saved)||saved<0){err.textContent="Enter a goal name, a positive target and a valid saved amount.";err.classList.remove("hidden");return;}
    const existing=state.goals.find(g=>g.id===$("goalId").value);await put("goals",{id:existing?.id||id(),name,targetAmount:rupees(target),savedAmount:rupees(saved),targetDate:$("goalDate").value||null,createdAt:existing?.createdAt||new Date().toISOString()});hideModal("goalModal");await refresh();toast(existing?"Goal updated":"Savings goal created");
  }
  async function deleteTransaction(txId){if(!confirm("Delete this transaction? This cannot be undone."))return;await del("transactions",txId);await refresh();toast("Transaction deleted");}
  async function deleteBudget(budgetId){if(!confirm("Delete this budget?"))return;await del("budgets",budgetId);await refresh();toast("Budget deleted");}
  async function deleteGoal(goalId){if(!confirm("Delete this savings goal?"))return;await del("goals",goalId);await refresh();toast("Savings goal deleted");}
  function checkBudgetAlerts(){
    const alerts=[];for(const b of dashboardBudgets()){if(!(b.limitAmount>0))continue;const pct=b.spent/b.limitAmount;const threshold=pct>=1?1:pct>=.8?.8:pct>=.5?.5:0;if(!threshold)continue;const key=`spendly-alert-${state.month}-${b.categoryId||"all"}-${threshold}`;let seen=false;try{seen=localStorage.getItem(key)==="1";}catch{}if(!seen){alerts.push({key,label:b.categoryId?category(b.categoryId).name:"Overall budget",threshold});try{localStorage.setItem(key,"1");}catch{}}}
    if(alerts.length){const a=alerts[0];toast(alerts.length===1?`${a.label}: ${Math.round(a.threshold*100)}% of budget used${a.threshold===1?" — limit reached":""}.`:`${alerts.length} budget alert${alerts.length===1?"":"s"}: ${a.label} is ${Math.round(a.threshold*100)}% used.`,alerts.some(x=>x.threshold===1)?"error":"success");}
  }
  function download(name,content,mime){
    const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportCSV(){
    const rows=[["id","type","amount_rupees","category","date","payment_method","note"],...state.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(t=>[t.id,t.type,fromPaise(t.amount).toFixed(2),category(t.categoryId).name,t.date,t.paymentMethod,t.note||""])];
    const csv=rows.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
    download(`spendly-transactions-${state.month}.csv`,"\uFEFF"+csv,"text/csv;charset=utf-8");toast("CSV export downloaded");
  }
  async function exportJSON(){
    const data={app:"Spendly",version:2,exportedAt:new Date().toISOString(),settings:state.settings,transactions:state.transactions,categories:state.categories,budgets:state.budgets,goals:state.goals,recurring:state.recurring,tombstones:await getMeta("tombstones",{})};
    download(`spendly-backup-${today()}.json`,JSON.stringify(data,null,2),"application/json");toast("Backup exported");
  }
  async function importJSON(file){
    if(!file)return;try{
      const text=await file.text();if(text.length>25*1024*1024)throw new Error("Backup is too large (maximum 25 MB).");const d=JSON.parse(text);
      if(d.app!=="Spendly"||!Array.isArray(d.transactions)||!Array.isArray(d.categories)||!Array.isArray(d.budgets)||!Array.isArray(d.goals))throw new Error("This file doesn't look like a valid Spendly backup.");if(!Array.isArray(d.recurring))d.recurring=[];if(!d.tombstones||typeof d.tombstones!=="object"||Array.isArray(d.tombstones))d.tombstones={};
      if(!confirm("Restore this backup? This replaces all current Spendly data in this browser."))return;
      const validTx=d.transactions.every(t=>t&&typeof t.id==="string"&&["income","expense"].includes(t.type)&&Number.isSafeInteger(t.amount)&&t.amount>=0&&typeof t.date==="string");
      const validBud=d.budgets.every(b=>b&&typeof b.id==="string"&&typeof b.month==="string"&&Number.isSafeInteger(b.limitAmount)&&b.limitAmount>0);
      const validGoals=d.goals.every(g=>g&&typeof g.id==="string"&&Number.isSafeInteger(g.targetAmount)&&g.targetAmount>0&&Number.isSafeInteger(g.savedAmount)&&g.savedAmount>=0);const validRecurring=d.recurring.every(r=>r&&typeof r.id==="string"&&typeof r.name==="string"&&Number.isSafeInteger(r.amount)&&r.amount>0&&typeof r.nextDueDate==="string"&&["weekly","monthly","yearly"].includes(r.frequency));
      if(!validTx||!validBud||!validGoals||!validRecurring||d.categories.some(c=>!c||typeof c.id!=="string"||typeof c.name!=="string"))throw new Error("Backup contains invalid or unsupported records.");
      state.cloudApplying=true;for(const s of ["transactions","categories","budgets","goals","recurring"])await clearStore(s);
      for(const s of ["transactions","categories","budgets","goals","recurring"])for(const item of (d[s]||[]))await put(s,item);await setMeta("tombstones",d.tombstones||{});
      if(d.settings&&typeof d.settings==="object")await setMeta("settings",{...state.settings,...d.settings});
      state.cloudApplying=false;await refresh();scheduleCloudPush();toast("Backup restored successfully");
    }catch(err){state.cloudApplying=false;toast(err.message||"Could not restore backup","error");}finally{$("importJson").value="";}
  }
  async function loadDemo(){
    if(state.transactions.length&&!confirm("Demo data will be added to your current transactions. Continue?"))return;
    const todayDate=new Date();const demo=[];
    const add=(monthsAgo,day,type,amount,cat,note,payment="UPI")=>{const d=new Date(todayDate.getFullYear(),todayDate.getMonth()-monthsAgo,day);const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;demo.push({id:id(),type,amount:rupees(amount),categoryId:cat,date,paymentMethod:payment,note,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),tags:[]});};
    add(0,2,"income",15000,"pocket-money","Monthly pocket money","Bank transfer");add(0,4,"expense",120,"food","Breakfast and chai","UPI");add(0,5,"expense",180,"transport","Metro recharge","UPI");add(0,6,"expense",250,"food","Dinner with friends","UPI");add(0,8,"expense",399,"bills","Mobile recharge","UPI");add(0,9,"expense",650,"education","Course materials","Debit card");add(0,11,"income",2500,"freelance","Small freelance task","Bank transfer");add(0,12,"expense",320,"shopping","T-shirt","UPI");add(0,14,"expense",90,"food","Evening snacks","Cash");add(0,16,"expense",240,"transport","Cab share","UPI");add(1,2,"income",15000,"pocket-money","Monthly pocket money","Bank transfer");add(1,3,"expense",140,"food","Cafe","UPI");add(1,5,"expense",500,"education","Books","Debit card");add(1,8,"expense",700,"shopping","Headphones accessories","UPI");add(1,11,"expense",300,"transport","Travel","UPI");add(1,16,"income",1800,"freelance","Design work","Bank transfer");add(1,20,"expense",250,"entertainment","Movie","UPI");add(2,2,"income",15000,"pocket-money","Monthly pocket money","Bank transfer");add(2,5,"expense",600,"education","Online course","UPI");add(2,8,"expense",450,"food","Meals","UPI");add(2,12,"expense",220,"transport","Auto fare","Cash");add(2,18,"expense",900,"shopping","Shoes","UPI");
    for(const t of demo)await put("transactions",t);
    if(!state.budgets.some(b=>b.month===state.month&&b.categoryId===null))await put("budgets",{id:id(),month:state.month,categoryId:null,limitAmount:rupees(12000),createdAt:new Date().toISOString()});
    if(!state.budgets.some(b=>b.month===state.month&&b.categoryId==="food"))await put("budgets",{id:id(),month:state.month,categoryId:"food",limitAmount:rupees(2500),createdAt:new Date().toISOString()});
    if(!state.goals.length){await put("goals",{id:id(),name:"New laptop",targetAmount:rupees(60000),savedAmount:rupees(12500),targetDate:null,createdAt:new Date().toISOString()});await put("goals",{id:id(),name:"Emergency fund",targetAmount:rupees(20000),savedAmount:rupees(5000),targetDate:null,createdAt:new Date().toISOString()});}
    await refresh();toast("Demo data added. You can delete it or clear all data in Settings.");
  }
  function renderPlanner(){
    if(!$('spendCalendar'))return;
    const cat=$('recurringCategory');if(cat){const old=cat.value;cat.innerHTML=state.categories.filter(c=>c.type==='expense').map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');if([...cat.options].some(o=>o.value===old))cat.value=old;}
    if($('recurringDate')&&!$('recurringDate').value)$('recurringDate').value=today();renderCalendar();renderRecurring();renderMonthlySummary();renderCloudStatus();
  }
  function renderCalendar(){
    const host=$('spendCalendar');if(!host)return;const [y,m]=state.month.split('-').map(Number),first=new Date(y,m-1,1),days=new Date(y,m,0).getDate(),offset=first.getDay();
    const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];let out=weekdays.map(x=>`<div class="calendar-weekday">${x}</div>`).join('');
    for(let i=0;i<offset;i++)out+='<div class="calendar-day empty"></div>';
    for(let d=1;d<=days;d++){const date=`${state.month}-${String(d).padStart(2,'0')}`,amount=expenses(state.transactions.filter(t=>t.date===date)),selected=state.selectedCalendarDate===date;out+=`<button type="button" class="calendar-day ${amount?'has-spend':''} ${selected?'selected':''}" data-cal-date="${date}"><span class="day-num">${d}</span><span class="day-total">${amount?fmt(amount,true):''}</span></button>`;}
    host.innerHTML=out;const date=state.selectedCalendarDate&&monthOf(state.selectedCalendarDate)===state.month?state.selectedCalendarDate:`${state.month}-${String(Math.min(new Date().getDate(),days)).padStart(2,'0')}`;state.selectedCalendarDate=date;
    const list=state.transactions.filter(t=>t.date===date).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));$('calendarDayDetails').innerHTML=`<strong>${escapeHtml(dateLabel(date,{weekday:'long',day:'numeric',month:'long'}))}</strong><div style="margin-top:8px">${list.length?list.map(t=>`<div class="setting-row"><span>${escapeHtml(t.note||category(t.categoryId).name)}</span><strong>${t.type==='expense'?'−':'+'}${fmt(t.amount)}</strong></div>`).join(''):'No transactions recorded for this date.'}</div>`;
  }
  function renderRecurring(){
    const host=$('recurringList');if(!host)return;const items=[...state.recurring].sort((a,b)=>String(a.nextDueDate).localeCompare(String(b.nextDueDate)));
    host.innerHTML=items.length?items.map(r=>{const overdue=r.nextDueDate<today();return `<div class="recurring-item"><div><strong>${escapeHtml(r.name)}</strong><small>${fmt(r.amount)} · ${escapeHtml(r.frequency)} · Due ${escapeHtml(dateLabel(r.nextDueDate,{day:'numeric',month:'short',year:'numeric'}))}${overdue?' · OVERDUE':''}</small></div><div class="recurring-actions"><button class="secondary-button small" data-recurring-action="paid" data-id="${escapeHtml(r.id)}">Mark paid</button><button class="danger-button" data-recurring-action="delete" data-id="${escapeHtml(r.id)}" aria-label="Delete ${escapeHtml(r.name)}">×</button></div></div>`;}).join(''):'<p class="empty-state compact-empty">No recurring bills yet. Add your rent, mess fees, recharge or subscriptions.</p>';
    const due=items.filter(r=>r.nextDueDate<=today());for(const r of due){const key=`spendly-due-${r.id}-${today()}`;let seen=false;try{seen=localStorage.getItem(key)==='1';}catch{}if(!seen){toast(`${r.name} ${r.nextDueDate<today()?'is overdue':'is due today'} · ${fmt(r.amount)}`,r.nextDueDate<today()?'error':'success');try{localStorage.setItem(key,'1');}catch{}}}const upcoming=items.filter(r=>r.nextDueDate<=addDays(today(),7));if(upcoming.length){const n=upcoming.filter(r=>r.nextDueDate<=today()).length;const existing=$('smartInsights');if(existing&&state.page==='planner'&&n)existing.insertAdjacentHTML('afterbegin',`<div class="smart-insight">${n} recurring bill${n===1?' is':'s are'} due or overdue. Check your bill list.</div>`);}
  }
  function addDays(iso,n){const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function nextDue(date,frequency){const d=new Date(`${date}T12:00:00`);if(frequency==='weekly')d.setDate(d.getDate()+7);else if(frequency==='yearly')d.setFullYear(d.getFullYear()+1);else{const day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));}return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  async function saveRecurring(e){e.preventDefault();const name=$('recurringName').value.trim(),amount=Number($('recurringAmount').value),nextDueDate=$('recurringDate').value;if(!name||!Number.isFinite(amount)||amount<=0||!nextDueDate){toast('Enter a name, valid amount and due date.','error');return;}await put('recurring',{id:id(),name,amount:rupees(amount),nextDueDate,frequency:$('recurringFrequency').value,categoryId:$('recurringCategory').value,createdAt:new Date().toISOString(),active:true});$('recurringForm').reset();$('recurringDate').value=today();await refresh();toast('Recurring bill saved. Reminder appears in Spendly when you open it.');}
  async function createTransactionFromRecurring(item){const tx={id:id(),type:'expense',amount:item.amount,categoryId:item.categoryId,date:item.nextDueDate,paymentMethod:'UPI',note:item.name,tags:['recurring'],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await put('transactions',tx);item.nextDueDate=nextDue(item.nextDueDate,item.frequency);await put('recurring',item);state.month=monthOf(tx.date);$('globalMonth').value=state.month;await refresh();toast('Payment recorded and next due date updated.');}
  function renderMonthlySummary(){
    const host=$('monthlyReportSummary');if(!host)return;const tx=txForMonth(),inc=income(tx),exp=expenses(tx),net=inc-exp,prev=new Date(`${state.month}-01T12:00:00`);prev.setMonth(prev.getMonth()-1);const pm=`${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`,prevExp=expenses(txForMonth(pm));
    host.innerHTML=`<div class="report-stat"><span>Income</span><strong>${fmt(inc)}</strong></div><div class="report-stat"><span>Expenses</span><strong>${fmt(exp)}</strong></div><div class="report-stat"><span>Net cash flow</span><strong>${fmt(net)}</strong></div><div class="report-stat"><span>vs previous month</span><strong>${prevExp?`${((exp-prevExp)/prevExp*100).toFixed(1)}%`:exp?'New activity':'—'}</strong></div>`;
    const insights=[];if(exp>0&&prevExp>0){const pct=(exp-prevExp)/prevExp*100;insights.push(`Spending is ${Math.abs(pct).toFixed(1)}% ${pct>0?'higher':'lower'} than ${monthLabel(pm)}.`);}const cats=categorySpend(tx);if(cats.length)insights.push(`${cats[0].name} is your largest expense category at ${fmt(cats[0].amount)}.`);const budgets=dashboardBudgets();for(const b of budgets){const pct=b.limitAmount?Math.round(b.spent/b.limitAmount*100):0;if(pct>=50)insights.push(`${b.categoryId?category(b.categoryId).name:'Overall budget'} is ${pct}% used.`);}if(!insights.length)insights.push('Add a few transactions to unlock personalized spending insights.');$('smartInsights').innerHTML=insights.map(x=>`<div class="smart-insight">${escapeHtml(x)}</div>`).join('');
  }
  function selectedMonthTransactions(){return state.transactions.filter(t=>monthOf(t.date)===state.month).sort((a,b)=>a.date.localeCompare(b.date));}
  function exportSelectedMonthCSV(){const items=selectedMonthTransactions();const rows=[['date','type','amount_rupees','category','payment_method','note'],...items.map(t=>[t.date,t.type,fromPaise(t.amount).toFixed(2),category(t.categoryId).name,t.paymentMethod,t.note||''])];const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');download(`spendly-${state.month}-report.csv`,'\uFEFF'+csv,'text/csv;charset=utf-8');toast('Selected-month CSV downloaded.');}
  function printMonthlyReport(){
    const tx=selectedMonthTransactions(),inc=income(tx),exp=expenses(tx),net=inc-exp,cats=categorySpend(tx),rows=tx.map(t=>`<tr><td>${escapeHtml(t.date)}</td><td>${escapeHtml(t.type)}</td><td>${escapeHtml(category(t.categoryId).name)}</td><td>${escapeHtml(t.note||'—')}</td><td style="text-align:right">${escapeHtml(fmt(t.amount))}</td></tr>`).join('');
    const w=window.open('','_blank','width=900,height=700');if(!w){toast('Allow pop-ups to print the report.','error');return;}w.document.write(`<!doctype html><html><head><title>Spendly ${escapeHtml(state.month)} report</title><meta charset="utf-8"><style>body{font:14px system-ui;margin:36px;color:#172033}h1{margin-bottom:4px}p{color:#667085}.stats{display:flex;gap:12px;margin:24px 0}.stats div{border:1px solid #ddd;padding:12px;border-radius:8px;flex:1}.stats span{display:block;color:#667085;font-size:12px}.stats strong{font-size:20px}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}th{background:#f5f6f8}@media print{button{display:none}}</style></head><body><h1>Spendly · Monthly report</h1><p>${escapeHtml(monthLabel(state.month))} · Generated ${escapeHtml(today())}</p><div class="stats"><div><span>Income</span><strong>${escapeHtml(fmt(inc))}</strong></div><div><span>Expenses</span><strong>${escapeHtml(fmt(exp))}</strong></div><div><span>Net cash flow</span><strong>${escapeHtml(fmt(net))}</strong></div></div><h2>Category breakdown</h2><ul>${cats.map(c=>`<li>${escapeHtml(c.name)}: ${escapeHtml(fmt(c.amount))}</li>`).join('')||'<li>No expenses recorded</li>'}</ul><h2>Transactions</h2><table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No transactions recorded for this month.</td></tr>'}</tbody></table><p>Personal tracking report. Verify records before making financial decisions.</p><button onclick="window.print()">Print / Save as PDF</button><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);w.document.close();
  }
  async function scanReceipt(){const file=$('receiptFile').files?.[0];if(!file){toast('Choose a receipt image first.','error');return;}if(!file.type.startsWith('image/')){toast('Please select an image file.','error');return;}const status=$('receiptStatus');status.textContent='Loading OCR engine…';try{if(!window.Tesseract){await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('OCR library could not load. Check your internet connection.'));document.head.appendChild(s);});}status.textContent='Reading receipt image in your browser…';const result=await window.Tesseract.recognize(file,'eng');const text=result.data.text||'';$('receiptText').value=text;const matches=[...text.matchAll(/(?:₹|INR|Rs\.?\s*)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi)].map(m=>Number(m[1].replace(/,/g,''))).filter(n=>n>0);if(matches.length)$('receiptAmount').value=Math.max(...matches).toFixed(2);const dateMatch=text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);if(dateMatch){let a=Number(dateMatch[1]),b=Number(dateMatch[2]),y=Number(dateMatch[3]);if(y<100)y+=2000;let mm=a>12?b:a,dd=a>12?a:b;if(mm>=1&&mm<=12&&dd>=1&&dd<=31)$('receiptDate').value=`${y}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;}status.textContent='Scan complete. Verify the extracted details before using them.';toast('Receipt scanned. Verify the result.');}catch(err){status.textContent=err.message||'Could not scan receipt.';toast(status.textContent,'error');}}
  function useReceiptDetails(){const amount=Number($('receiptAmount').value),date=$('receiptDate').value||today();if(!Number.isFinite(amount)||amount<=0){toast('Enter or verify a valid amount first.','error');return;}openTransaction();$('txAmount').value=amount.toFixed(2);$('txDate').value=date;$('txNote').value='Receipt expense';$('txType').value='expense';state.txType='expense';document.querySelectorAll('[data-txtype]').forEach(b=>b.classList.toggle('active',b.dataset.txtype==='expense'));addCategoryOptions($('txCategory'),'expense');toast('Receipt details copied to the transaction form. Check them before saving.');}
  function hasCloudConfig(){const c=window.SPENDLY_CONFIG||{};return !!(c.SUPABASE_URL&&c.SUPABASE_ANON_KEY&&!c.SUPABASE_URL.includes('YOUR-PROJECT')&&!c.SUPABASE_ANON_KEY.includes('YOUR_SUPABASE'));}
  function cloudConfigured(){return !!(hasCloudConfig()&&window.supabase?.createClient);}
  function renderCloudStatus(message){const el=$('cloudStatus');if(!el)return;if(message){el.textContent=message;el.classList.toggle('error',/error|failed|could not|not configured/i.test(message));el.classList.toggle('connected',/signed in|synced|sync complete/i.test(message));return;}if(!hasCloudConfig())el.textContent='Cloud sync is not configured. Local storage still works.';else if(!window.supabase?.createClient)el.textContent='Loading cloud sync library…';else if(state.cloudUser)el.textContent=`Signed in as ${state.cloudUser.email||'your account'}. Cloud sync is enabled.`;else el.textContent='Cloud is configured. Sign in to enable sync.';}
  function initCloud(){if(!hasCloudConfig()){renderCloudStatus();return;}if(!window.supabase?.createClient){renderCloudStatus('Loading Supabase client…');const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.onload=()=>initCloud();script.onerror=()=>renderCloudStatus('Could not load Supabase client. Local data still works; check your internet connection.');document.head.appendChild(script);return;}try{const c=window.SPENDLY_CONFIG;state.cloudClient=window.supabase.createClient(c.SUPABASE_URL,c.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});state.cloudClient.auth.getSession().then(async({data,error})=>{if(error)throw error;if(data.session){state.cloudUser=data.session.user;await cloudSyncNow(false);}renderCloudStatus();}).catch(e=>renderCloudStatus(`Cloud auth error: ${e.message}`));state.cloudClient.auth.onAuthStateChange((event,session)=>{setTimeout(async()=>{state.cloudUser=session?.user||null;renderCloudStatus();},0);});}catch(e){renderCloudStatus(`Cloud initialization error: ${e.message}`);}}
  async function cloudSignIn(){if(!state.cloudClient){renderCloudStatus('Cloud is not configured. Follow SUPABASE_SETUP.md first.');return;}const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||!password)return;renderCloudStatus('Signing in…');const{data,error}=await state.cloudClient.auth.signInWithPassword({email,password});if(error){renderCloudStatus(`Sign-in failed: ${error.message}`);toast('Sign-in failed. Check credentials and Supabase email settings.','error');return;}state.cloudUser=data.user;await cloudSyncNow(false);renderCloudStatus();toast('Signed in and cloud sync checked.');}
  async function cloudSignUp(){if(!state.cloudClient){renderCloudStatus('Cloud is not configured. Follow SUPABASE_SETUP.md first.');return;}const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;if(!email||password.length<6){toast('Enter an email and password with at least 6 characters.','error');return;}renderCloudStatus('Creating account…');const{data,error}=await state.cloudClient.auth.signUp({email,password});if(error){renderCloudStatus(`Sign-up failed: ${error.message}`);return;}if(data.session){state.cloudUser=data.user;await cloudSyncNow(false);renderCloudStatus('Account created and signed in.');}else renderCloudStatus('Account created. Check your email to confirm, then sign in.');}
  async function cloudSignOut(){if(!state.cloudClient){renderCloudStatus('Cloud is not configured.');return;}const{error}=await state.cloudClient.auth.signOut();if(error){renderCloudStatus(`Sign-out failed: ${error.message}`);return;}state.cloudUser=null;renderCloudStatus('Signed out. Your local copy remains on this device.');toast('Signed out. Local data was kept.');}
  async function recordTombstone(store,key){if(!['transactions','budgets','goals','recurring','categories'].includes(store))return;const all=await getMeta('tombstones',{});if(!all[store])all[store]={};all[store][String(key)]=new Date().toISOString();await setMeta('tombstones',all);}
  function mergeTombstones(local,remote){const result={};for(const store of new Set([...Object.keys(remote||{}),...Object.keys(local||{})])){result[store]={...(remote?.[store]||{})};for(const [key,time] of Object.entries(local?.[store]||{})){if(!result[store][key]||String(time)>String(result[store][key]))result[store][key]=time;}}return result;}
  function filterTombstoned(rows,tombstones,store){return (rows||[]).filter(row=>{const deletedAt=tombstones?.[store]?.[row.id];if(!deletedAt)return true;const changed=row.updatedAt||row.createdAt||'';return String(changed)>String(deletedAt);});}
  async function readLocalSnapshot(){const[transactions,categories,budgets,goals,recurring,settings,tombstones]=await Promise.all([getAll('transactions'),getAll('categories'),getAll('budgets'),getAll('goals'),getAll('recurring'),getMeta('settings',state.settings),getMeta('tombstones',{})]);return{version:2,transactions,categories,budgets,goals,recurring,settings,tombstones};}
  function mergeRows(localRows,cloudRows){const map=new Map();for(const x of cloudRows||[])if(x?.id)map.set(x.id,x);for(const x of localRows||[])if(x?.id){const old=map.get(x.id),a=Date.parse(x.updatedAt||x.createdAt||0)||0,b=Date.parse(old?.updatedAt||old?.createdAt||0)||0;if(!old||a>=b)map.set(x.id,x);}return [...map.values()];}
  async function applySnapshot(snapshot){state.cloudApplying=true;try{for(const store of ['transactions','categories','budgets','goals','recurring'])await clearStore(store);for(const store of ['transactions','categories','budgets','goals','recurring'])for(const row of (snapshot[store]||[]))await put(store,row);if(snapshot.settings&&typeof snapshot.settings==='object')await setMeta('settings',{...state.settings,...snapshot.settings});await setMeta('tombstones',snapshot.tombstones||{});}finally{state.cloudApplying=false;}await refresh();}
  function scheduleCloudPush(){if(!state.cloudClient||!state.cloudUser||state.cloudApplying)return;clearTimeout(state.cloudTimer);state.cloudTimer=setTimeout(()=>cloudSyncNow(true),900);}
  async function cloudSyncNow(showToast=false){if(!state.cloudClient||!state.cloudUser){if(showToast)renderCloudStatus('Sign in to sync this device.');return;}try{renderCloudStatus('Syncing your data…');const client=state.cloudClient,user=state.cloudUser;const{data:row,error}=await client.from('spendly_user_data').select('payload,updated_at').eq('user_id',user.id).maybeSingle();if(error)throw error;const local=await readLocalSnapshot();if(!row){const{error:upErr}=await client.from('spendly_user_data').upsert({user_id:user.id,payload:local,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(upErr)throw upErr;}else{const remote=row.payload||{};const merged={version:2};merged.tombstones=mergeTombstones(local.tombstones,remote.tombstones);for(const store of ['transactions','categories','budgets','goals','recurring'])merged[store]=filterTombstoned(mergeRows(local[store],remote[store]),merged.tombstones,store);const localHasRecords=['transactions','budgets','goals','recurring'].some(k=>(local[k]||[]).length>0);merged.settings=localHasRecords?{...(remote.settings||{}),...(local.settings||{})}:{...(local.settings||{}),...(remote.settings||{})};await applySnapshot(merged);const{error:upErr}=await client.from('spendly_user_data').upsert({user_id:user.id,payload:merged,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(upErr)throw upErr;}renderCloudStatus('Sync complete. Your data is saved to this account.');if(showToast)toast('Cloud sync complete.');}catch(e){renderCloudStatus(`Cloud sync failed: ${e.message}. Your local data is still available.`);if(showToast)toast('Cloud sync failed. Local data is preserved.','error');}}

  function handleDelegatedClick(e){
    const target=e.target.closest("button");if(!target)return;
    if(target.dataset.goto){setPage(target.dataset.goto);return;}
    if(target.dataset.editTx){const t=state.transactions.find(x=>x.id===target.dataset.editTx);if(t)openTransaction(t);return;}
    if(target.dataset.deleteTx){deleteTransaction(target.dataset.deleteTx);return;}
    if(target.dataset.editBudget){const b=state.budgets.find(x=>x.id===target.dataset.editBudget);if(b){if(b.month!==state.month){state.month=b.month;$("globalMonth").value=state.month;renderAll();}openBudget(b);}return;}
    if(target.dataset.deleteBudget){deleteBudget(target.dataset.deleteBudget);return;}
    if(target.dataset.editGoal){const g=state.goals.find(x=>x.id===target.dataset.editGoal);if(g)openGoal(g);return;}
    if(target.dataset.deleteGoal){deleteGoal(target.dataset.deleteGoal);return;}
    if(target.dataset.contributeGoal){$("contributionGoalId").value=target.dataset.contributeGoal;$("contributionAmount").value="";showModal("contributionModal");return;}
  }
  function setupEvents(){
    document.querySelectorAll(".nav-item[data-page]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.page)));
    document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>setPage(b.dataset.goto)));
    document.addEventListener("click",handleDelegatedClick);
    $("menuToggle").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
    $("globalMonth").value=state.month;$("globalMonth").addEventListener("change",()=>{if($("globalMonth").value){state.month=$("globalMonth").value;renderAll();}});
    $("quickAdd").addEventListener("click",()=>openTransaction());$("transactionsAdd").addEventListener("click",()=>openTransaction());$("firstAdd").addEventListener("click",()=>openTransaction());$("emptyAdd").addEventListener("click",()=>openTransaction());
    $("budgetAdd").addEventListener("click",()=>openBudget());$("budgetEmptyAdd").addEventListener("click",()=>openBudget());$("goalAdd").addEventListener("click",()=>openGoal());$("goalEmptyAdd").addEventListener("click",()=>openGoal());
    document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>hideModal(b.dataset.close)));
    document.querySelectorAll(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)hideModal(m.id);}));
    document.addEventListener("keydown",e=>{if(e.key==="Escape")document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach(m=>hideModal(m.id));if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();setPage("transactions");$("txSearch").focus();}});
    document.querySelectorAll("[data-txtype]").forEach(b=>b.addEventListener("click",()=>{state.txType=b.dataset.txtype;$("txType").value=state.txType;document.querySelectorAll("[data-txtype]").forEach(x=>x.classList.toggle("active",x===b));const old=$("txCategory").value;addCategoryOptions($("txCategory"),state.txType);if([...$("txCategory").options].some(o=>o.value===old))$("txCategory").value=old;}));
    $("transactionForm").addEventListener("submit",saveTransaction);$("budgetForm").addEventListener("submit",saveBudget);$("goalForm").addEventListener("submit",saveGoal);
    ["txSearch","txTypeFilter","txCategoryFilter","txPaymentFilter"].forEach(k=>$(k).addEventListener(k==="txSearch"?"input":"change",renderTransactions));
    $("themeToggle").addEventListener("click",async()=>{const now=document.body.classList.contains("dark")?"light":"dark";applyTheme(now);state.settings.theme=now;await setMeta("settings",state.settings);renderAll();});
    $("themeSelect").addEventListener("change",async()=>{applyTheme($("themeSelect").value);state.settings.theme=$("themeSelect").value;await setMeta("settings",state.settings);renderAll();});
    $("openingBalanceBtn").addEventListener("click",()=>{$("openingAmount").value=fromPaise(state.settings.openingBalance||0);showModal("openingModal");});
    $("openingForm").addEventListener("submit",async e=>{e.preventDefault();const amount=Number($("openingAmount").value);if(!Number.isFinite(amount)||amount<0){toast("Enter a valid opening balance","error");return;}state.settings.openingBalance=rupees(amount);await setMeta("settings",state.settings);hideModal("openingModal");renderAll();toast("Opening balance saved");});
    $("contributionForm").addEventListener("submit",async e=>{e.preventDefault();const amount=Number($("contributionAmount").value),g=state.goals.find(x=>x.id===$("contributionGoalId").value);if(!g||!Number.isFinite(amount)||amount<=0){toast("Enter a valid contribution","error");return;}g.savedAmount+=rupees(amount);await put("goals",g);hideModal("contributionModal");await refresh();toast("Savings progress updated");});
    $("exportCsv").addEventListener("click",exportCSV);$("settingsCsv").addEventListener("click",exportCSV);$("exportJson").addEventListener("click",exportJSON);$("importJson").addEventListener("change",e=>importJSON(e.target.files?.[0]));
    $("addRecurring").addEventListener("click",()=>{$("recurringName").focus();});
    $("recurringForm").addEventListener("submit",saveRecurring);
    $("spendCalendar").addEventListener("click",e=>{const b=e.target.closest("[data-cal-date]");if(b){state.selectedCalendarDate=b.dataset.calDate;renderCalendar();}});
    $("recurringList").addEventListener("click",async e=>{const b=e.target.closest("button[data-recurring-action]");if(!b)return;const item=state.recurring.find(x=>x.id===b.dataset.id);if(!item)return;if(b.dataset.recurringAction==="delete"){if(confirm("Delete this recurring reminder?")){await del("recurring",item.id);await refresh();toast("Recurring reminder deleted");}}else if(b.dataset.recurringAction==="paid"){await createTransactionFromRecurring(item);}});
    $("printReport").addEventListener("click",printMonthlyReport);$("downloadMonthlyPdf").addEventListener("click",printMonthlyReport);$("downloadMonthlyCsv").addEventListener("click",exportSelectedMonthCSV);
    $("scanReceipt").addEventListener("click",scanReceipt);$("useReceipt").addEventListener("click",useReceiptDetails);
    $("cloudAuthForm").addEventListener("submit",e=>{e.preventDefault();cloudSignIn();});$("cloudSignUp").addEventListener("click",cloudSignUp);$("cloudSignOut").addEventListener("click",cloudSignOut);$("cloudSyncNow").addEventListener("click",()=>cloudSyncNow(true));
    $("loadDemo").addEventListener("click",loadDemo);
    $("clearData").addEventListener("click",async()=>{if(!confirm("Permanently delete all Spendly data in this browser? Export a backup first if you might need it."))return;if(!confirm("Last check: all transactions, budgets and goals will be erased. Continue?"))return;for(const store of ["transactions","budgets","goals","recurring"])for(const row of state[store])await recordTombstone(store,row.id);for(const row of state.categories.filter(c=>!c.isDefault))await recordTombstone("categories",row.id);for(const s of ["transactions","budgets","goals","recurring"])await clearStore(s);await clearStore("categories");for(const c of DEFAULT_CATEGORIES)await put("categories",c);state.settings={theme:state.settings.theme||"light",currency:"INR",openingBalance:0};await setMeta("settings",state.settings);await refresh();toast("All Spendly data cleared");});
    window.addEventListener("resize",()=>{clearTimeout(window.__spendlyResize);window.__spendlyResize=setTimeout(()=>{drawBars($("cashflowChart"),lastSixMonths(),false);drawBars($("analyticsCashflowChart"),lastSixMonths(),true);const cats=categorySpend(txForMonth());drawDonut($("categoryChart"),cats.map(x=>({value:x.amount,color:x.color})));drawDonut($("analyticsCategoryChart"),cats.map(x=>({value:x.amount,color:x.color})));},100);});
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(state.settings.theme==="system"){applyTheme("system");renderAll();}});
  }
  async function init(){
    try{if(!("indexedDB" in window))throw new Error("This browser doesn't support IndexedDB. Try a recent version of Chrome, Edge, Firefox or Safari.");state.db=await openDB();state.settings=await getMeta("settings",{theme:"light",currency:"INR",openingBalance:0});const savedTheme=(()=>{try{return localStorage.getItem("spendly-theme")||state.settings.theme||"light";}catch{return state.settings.theme||"light";}})();state.settings.theme=savedTheme;applyTheme(savedTheme);setupEvents();await refresh();checkBudgetAlerts();initCloud();if(!state.transactions.length){$("recentEmpty").classList.remove("hidden");}
      const d=new Date();$("greetingDate").textContent=`YOUR MONEY, AT A GLANCE · ${monthLabel(state.month).toUpperCase()}`;
    }catch(err){document.body.innerHTML=`<main style="max-width:620px;margin:10vh auto;padding:28px;font-family:system-ui"><h1>Spendly couldn't start</h1><p>${escapeHtml(err.message||"An unexpected error occurred.")}</p><p>Open this app in a modern browser and make sure site storage is enabled.</p></main>`;}
  }
  init();
})();