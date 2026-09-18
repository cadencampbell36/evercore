// ── MARKET & SITUATIONAL (FRQ only — rehearsal, not retrieval; unscored for mastery)
const MARKET = [
{id:"mkt.why-evercore", area:"market", ch:"Why Banking / Why Our Firm", in400:true, d:3, tags:["DEFINITIONAL"], frqOnly:true,
 q:"Why Evercore?",
 ans:"A strong answer is specific and structural, not flattering. It names the independent advisory model — no balance sheet, no financing arm, so advice is not cross-sold against a lending relationship, and conflicts are structurally fewer. It names the consequence for a junior: smaller teams, earlier client exposure, and a higher ratio of advisory work to financing execution. It names a concrete deal or sector where Evercore led, and says what about that mandate interests you. It then closes with a specific person you spoke to and what they told you. Generic answers about culture and meritocracy are interchangeable across every bank and are read as a lack of preparation.",
 rub:["Names the independent advisory model and its structural consequence","Says what that means for a junior specifically","Cites a concrete deal, sector, or mandate","References a real conversation with a named person","Avoids interchangeable culture language"],
 target:75},
{id:"mkt.why-ma", area:"market", ch:"Why Banking / Why Our Firm", in400:true, d:2, tags:["DEFINITIONAL"], frqOnly:true,
 q:"Why M&A rather than a coverage group, markets, or the buy side?",
 ans:"A strong answer connects a concrete prior experience to the specific work of M&A: the analytical core of valuing a business and advising on whether and at what price a transaction should happen, the exposure to the full arc of a process, and the fact that the advice is the product rather than a financing outcome. It should acknowledge honestly what you are giving up — the markets seat's immediacy, the buy side's ownership of a position — rather than pretending M&A dominates on every axis.",
 rub:["Grounded in a specific prior experience","Names what M&A actually does day to day","Acknowledges the trade-off honestly","Does not disparage the alternatives"],
 target:75},
{id:"mkt.rates", area:"market", ch:"Market & Situational", in400:false, d:3, tags:["DIRECTION"], frqOnly:true,
 q:"How does the current rate environment affect M&A activity and valuations?",
 ans:"Higher rates raise the risk-free rate, which raises the cost of equity through CAPM and the cost of debt directly, so WACC rises and DCF valuations fall. Leveraged finance becomes more expensive and lenders tighten, so sponsors can support less debt at a given price, which compresses what financial buyers can pay and shifts the balance toward strategic acquirers with cash. Bid-ask spreads widen because sellers anchor to prior-cycle valuations, so volumes fall and processes take longer. When rates fall or are expected to, the mechanism runs in reverse and sponsor activity typically recovers first.",
 rub:["Rates → WACC → DCF values, with the mechanism named","Leveraged finance cost and lender appetite","Sponsors constrained relative to strategics","Bid-ask spread and volume effect","States the direction at each step"],
 target:90},
{id:"mkt.deal-walkthrough", area:"market", ch:"Market & Situational", in400:false, d:3, tags:["DEFINITIONAL"], frqOnly:true,
 q:"Walk me through a recent deal you have been following.",
 ans:"Structure it: who bought whom, for how much, and in what consideration. The implied multiple and how it compares to trading comps and precedents. The strategic rationale from the acquirer's side and why the seller sold now. The financing and what it implies about the acquirer's capital structure. Then your own view — whether you think the price was defensible and what you would want to diligence. The last part is what separates a real answer from a recitation of the press release.",
 rub:["Names parties, price, consideration mix","Implied multiple with a comparison point","Strategic rationale from BOTH sides","Financing structure","An actual opinion with a reason"],
 target:120}
];

// ── THREE-STATEMENT GRID: composable templates (hand-verified) ────────────────
// Each returns cells keyed "STATEMENT|line". delta is the change; 0 = assert no change.
// CFS cells carry a required `section`; BS cells carry a required `side`.
const IS_LINES  = ["Revenue","Operating expenses","Operating income","Pre-tax income","Taxes","Net income"];
const CFS_LINES = ["Net income","Depreciation & amortization","Write-down","Stock-based compensation",
                   "Change in working capital","Capital expenditures","Debt issued / (repaid)",
                   "Stock issued / (repurchased)","Purchase / sale of assets"];
const BS_LINES  = ["Cash","Accounts receivable","Inventory","PP&E","Accounts payable",
                   "Accrued compensation","Deferred revenue","Debt","Retained earnings",
                   "Additional paid-in capital"];

const TEMPLATES = {
  dep: {label:(a)=>`Depreciation increases by $${a}`, tagged:["dep"],
    cells:(a,t)=>[
      ["IS","Operating income",-a,null,null,"Depreciation is an operating expense, so it reduces EBIT."],
      ["IS","Pre-tax income",-a,null,null,"Flows straight down from operating income."],
      ["IS","Taxes",-a*t,null,null,`Lower pre-tax income means a lower tax bill: $${a} × ${t*100}%.`],
      ["IS","Net income",-a*(1-t),null,null,`Pre-tax income falls $${a}, taxes fall $${(a*t).toFixed(2)}, so net income falls $${(a*(1-t)).toFixed(2)}.`],
      ["CFS","Net income",-a*(1-t),"CFO",null,"The cash flow statement starts from net income."],
      ["CFS","Depreciation & amortization",a,"CFO",null,"Depreciation is non-cash, so it is added back in full."],
      ["BS","Cash",a*t,null,"asset",`Cash rises only by the tax shield: $${a} × ${t*100}% = $${(a*t).toFixed(2)}.`],
      ["BS","PP&E",-a,null,"asset","The asset is written down by the depreciation taken."],
      ["BS","Retained earnings",-a*(1-t),null,"equity","Net income flows into RETAINED EARNINGS. There is no 'net income' line on the balance sheet."]]},

  writedown: {label:(a)=>`Inventory is written down by $${a}`, tagged:["writedown"],
    cells:(a,t)=>[
      ["IS","Pre-tax income",-a,null,null,"The write-down is recognized as an expense."],
      ["IS","Taxes",-a*t,null,null,"The write-down is deductible, so taxes fall."],
      ["IS","Net income",-a*(1-t),null,null,`Net income falls by $${(a*(1-t)).toFixed(2)}.`],
      ["CFS","Net income",-a*(1-t),"CFO",null,"Starting point."],
      ["CFS","Write-down",a,"CFO",null,"Non-cash, so added back in full."],
      ["BS","Cash",a*t,null,"asset","Cash rises by the tax saving — the expense itself moved no cash."],
      ["BS","Inventory",-a,null,"asset","The written-down asset."],
      ["BS","Retained earnings",-a*(1-t),null,"equity","After-tax loss reduces retained earnings."]]},

  capex: {label:(a)=>`The company spends $${a} on capital expenditures`, tagged:["capex"],
    cells:(a,t)=>[
      ["CFS","Capital expenditures",-a,"CFI",null,"Buying an asset is INVESTING. Capitalized spend never touches CFO."],
      ["BS","Cash",-a,null,"asset","Cash leaves immediately."],
      ["BS","PP&E",a,null,"asset","An asset of equal value is created — that is what capitalizing means."]]},

  debt_issue: {label:(a)=>`The company issues $${a} of debt`, tagged:["debt_issue"],
    cells:(a,t)=>[
      ["CFS","Debt issued / (repaid)",a,"CFF",null,"Issued → raising capital → FINANCING. The instrument is irrelevant; the verb decides."],
      ["BS","Cash",a,null,"asset","Proceeds received."],
      ["BS","Debt",a,null,"liability","The obligation to repay. Liabilities side."]]},

  buyback: {label:(a)=>`The company repurchases $${a} of its own stock`, tagged:["buyback"],
    cells:(a,t)=>[
      ["CFS","Stock issued / (repurchased)",-a,"CFF",null,"Returning capital to shareholders → FINANCING."],
      ["BS","Cash",-a,null,"asset","Cash paid out."],
      ["BS","Additional paid-in capital",-a,null,"equity","Shareholders' equity falls by the amount repurchased."]]},

  accrue_comp: {label:(a)=>`The company accrues $${a} of employee compensation it has not yet paid`, tagged:["accrue_comp"],
    cells:(a,t)=>[
      ["IS","Operating income",-a,null,null,"The expense is recognized when EARNED by employees, not when paid. That is accrual accounting."],
      ["IS","Pre-tax income",-a,null,null,"Flows down."],
      ["IS","Taxes",-a*t,null,null,"Deductible expense."],
      ["IS","Net income",-a*(1-t),null,null,`Net income falls $${(a*(1-t)).toFixed(2)}.`],
      ["CFS","Net income",-a*(1-t),"CFO",null,"Starting point."],
      ["CFS","Change in working capital",a,"CFO",null,"The accrued liability ROSE, which is a SOURCE of cash: the expense was taken without paying."],
      ["BS","Cash",a*t,null,"asset","Only the tax saving is real cash this period."],
      ["BS","Accrued compensation",a,null,"liability","Money the company OWES its employees. LIABILITY — this is the side that gets missed."],
      ["BS","Retained earnings",-a*(1-t),null,"equity","After-tax expense."]]},

  deferred_rev: {label:(a)=>`The company collects $${a} in cash for a service it has not yet delivered`, tagged:["deferred_rev"],
    cells:(a,t)=>[
      ["CFS","Change in working capital",a,"CFO",null,"The deferred revenue liability rose — a source of cash."],
      ["BS","Cash",a,null,"asset","Cash collected up front."],
      ["BS","Deferred revenue",a,null,"liability","An obligation to DELIVER. Liability, despite the word 'revenue' in the name."]]},

  ar_collect: {label:(a)=>`The company collects $${a} of accounts receivable`, tagged:["ar_collect"],
    cells:(a,t)=>[
      ["CFS","Change in working capital",a,"CFO",null,"Receivables fell — an asset converted to cash, so a source of cash."],
      ["BS","Cash",a,null,"asset","Cash received."],
      ["BS","Accounts receivable",-a,null,"asset","The receivable is extinguished. No income statement impact: the revenue was recognized when earned."]]},

  inventory_buy: {label:(a)=>`The company purchases $${a} of inventory with cash`, tagged:["inventory_buy"],
    cells:(a,t)=>[
      ["CFS","Change in working capital",-a,"CFO",null,"Inventory rose — cash is tied up in the operating cycle. A USE of cash."],
      ["BS","Cash",-a,null,"asset","Cash paid."],
      ["BS","Inventory",a,null,"asset","No income statement impact until the inventory is sold and hits COGS."]]},

  sbc: {label:(a)=>`The company records $${a} of stock-based compensation`, tagged:["sbc"],
    cells:(a,t)=>[
      ["IS","Operating income",-a,null,null,"SBC is a real operating expense."],
      ["IS","Pre-tax income",-a,null,null,"Flows down."],
      ["IS","Taxes",-a*t,null,null,"Deductible."],
      ["IS","Net income",-a*(1-t),null,null,`Net income falls $${(a*(1-t)).toFixed(2)}.`],
      ["CFS","Net income",-a*(1-t),"CFO",null,"Starting point."],
      ["CFS","Stock-based compensation",a,"CFO",null,"Non-cash — the company paid in shares, not cash."],
      ["BS","Cash",a*t,null,"asset","Only the tax shield is cash."],
      ["BS","Retained earnings",-a*(1-t),null,"equity","After-tax expense."],
      ["BS","Additional paid-in capital",a,null,"equity","Shares were issued to employees. Equity rises by the full $"+a+" — this is the leg people forget, and without it the balance sheet will not balance."]]}
};

const SCENARIOS = [
  {id:"dep10",      steps:[["dep",10]],                          t:0.25, d:2},
  {id:"dep50",      steps:[["dep",50]],                          t:0.20, d:2},
  {id:"wd100",      steps:[["writedown",100]],                   t:0.25, d:3},
  {id:"capex200",   steps:[["capex",200]],                       t:0.25, d:2},
  {id:"debtcapex",  steps:[["debt_issue",200],["capex",200]],    t:0.25, d:3},
  {id:"buyback100", steps:[["buyback",100]],                     t:0.25, d:2},
  {id:"accrue40",   steps:[["accrue_comp",40]],                  t:0.25, d:3},
  {id:"defrev1200", steps:[["deferred_rev",1200]],               t:0.25, d:3},
  {id:"arcollect",  steps:[["ar_collect",100]],                  t:0.25, d:2},
  {id:"invbuy",     steps:[["inventory_buy",200]],               t:0.25, d:2},
  {id:"sbc50",      steps:[["sbc",50]],                          t:0.20, d:3},
  {id:"dep_accrue", steps:[["dep",20],["accrue_comp",30]],       t:0.25, d:4},
  {id:"sbc_capex",  steps:[["sbc",40],["capex",100]],            t:0.25, d:4},
  {id:"triple",     steps:[["dep",10],["inventory_buy",50],["debt_issue",100]], t:0.25, d:5}
];
