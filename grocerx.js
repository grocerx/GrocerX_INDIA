/* GrocerX India — grocerx.js v3 + Supabase */

/* ===== SUPABASE SETUP ===== */
const SUPA_URL = 'https://xohjjcrkgpbzpfabgynw.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvaGpqY3JrZ3BienBmYWJneW53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjcwNjgsImV4cCI6MjA5Mjg0MzA2OH0.0i1tz6OQuN9WyETEOvFQ97ftS32-ageFD2ee51pS6KM';
const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

let currentUser = null;

/* ===== AUTH ===== */
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await onUserLoggedIn();
  } else {
    const skipped = sessionStorage.getItem('gx-auth-skipped');
    if (!skipped) setTimeout(() => openAuthModal(), 1500);
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      closeAuthModal();
      await onUserLoggedIn();
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      onUserLoggedOut();
    }
  });
}

async function onUserLoggedIn() {
  updateProfileUI();
  await loadCartFromDB();
  await loadAddressFromDB();
  await loadOrdersFromDB();
  showToast('✅ Login Successfully! Welcome back 👋');
}

function onUserLoggedOut() {
  cart = {};
  orderHistory = [];
  savedAddress = { name:'', phone:'', house:'', area:'detecting..', city:'', pin:'' };
  upCart();
  updateProfileUI();
  showToast('👋 Logout ');
}

function updateProfileUI() {
  const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'GrocerX User';
  const email = currentUser?.email || '';
  const pn2 = document.querySelector('.pn2');
  const pph = document.querySelector('.pph');
  if (pn2) pn2.textContent = name;
  if (pph) pph.textContent = email;
}

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.href }
  });
  if (error) showToast('❌ Google login failed: ' + error.message);
}

async function sendMagicLink() {
  const email = document.getElementById('auth-email-input').value.trim();
  if (!email || !email.includes('@')) { showToast('⚠️ Valid email daalo!'); return; }
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href }
  });
  if (error) { showToast('❌ ' + error.message); return; }
  document.getElementById('auth-email-step1').style.display = 'none';
  document.getElementById('auth-email-step2').style.display = 'block';
}

async function signOut() {
  await sb.auth.signOut();
  // Clear skip flag taaki logout ke baad login modal khule
  sessionStorage.removeItem('gx-auth-skipped');
  closeAllSheets();
  // Thoda delay de, phir modal show karo
  setTimeout(() => openAuthModal(), 600);
}

function openAuthModal() {
  document.getElementById('auth-modal').style.display = 'flex';
}

function closeAuthModal() {
  document.getElementById('auth-modal').style.display = 'none';
  sessionStorage.setItem('gx-auth-skipped', '1');
}

/* ===== CART SYNC ===== */
async function saveCartToDB() {
  if (!currentUser) return;
  await sb.from('carts').upsert({
    user_id: currentUser.id,
    items: cart,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
}

async function loadCartFromDB() {
  if (!currentUser) return;
  const { data } = await sb.from('carts').select('items').eq('user_id', currentUser.id).single();
  if (data?.items) {
    cart = data.items;
    upCart();
    if (curPage === 'cart') renderCartPg();
    if (curPage === 'home') buildBestsellers();
  }
}

/* ===== ORDERS ===== */
async function saveOrderToDB(items, total) {
  if (!currentUser) return null;
  // Get user profile for seller info
  const { data: prof } = await sb.from('profiles').select('name,phone').eq('id', currentUser.id).single();
  const { data: addr } = await sb.from('addresses').select('*').eq('user_id', currentUser.id).single();

  // Auto-resolve shop_id: pick the single active shop (one seller MVP)
  let shopId = null;
  const { data: activeShops } = await sb.from('shops').select('id').eq('is_active', true).limit(1);
  if (activeShops && activeShops.length) shopId = activeShops[0].id;

  const { data } = await sb.from('orders').insert({
    user_id: currentUser.id,
    items: items,
    total: total,
    status: 'new',
    shop_id: shopId,
    user_name:  prof?.name  || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Customer',
    user_email: currentUser.email || '',
    user_phone: prof?.phone || savedAddress?.phone || '',
    user_avatar: currentUser.user_metadata?.avatar_url || null,
    delivery_address: addr ? {
      house: addr.house || '',
      area:  addr.area  || '',
      city:  addr.city  || '',
      pin:   addr.pin   || ''
    } : {
      house: savedAddress?.house || '',
      area:  savedAddress?.area  || '',
      city:  savedAddress?.city  || '',
      pin:   savedAddress?.pin   || ''
    }
  }).select().single();
  return data;
}

async function loadOrdersFromDB() {
  if (!currentUser) return;
  const { data } = await sb.from('orders')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (data) {
    orderHistory = data.map(o => ({
      id: 'ORD' + o.order_number,
      date: new Date(o.created_at).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}) + ' · ' + new Date(o.created_at).toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'}),
      items: Array.isArray(o.items) ? o.items.slice(0,3).map(i=>i.name+' x'+i.qty).join(', ') + (o.items.length>3 ? ` +${o.items.length-3} more` : '') : '',
      total: o.total
    }));
    const sm = document.getElementById('orders-small');
    if (sm && orderHistory.length) sm.textContent = orderHistory.length + ' order' + (orderHistory.length>1?'s':'') + ' placed';
  }
}

/* ===== ADDRESS ===== */
async function saveAddressToDB(addr) {
  if (!currentUser) return;
  const { data: existing } = await sb.from('addresses').select('id').eq('user_id', currentUser.id).single();
  if (existing) {
    await sb.from('addresses').update({ house:addr.house, area:addr.area, city:addr.city, pin:addr.pin }).eq('user_id', currentUser.id);
  } else {
    await sb.from('addresses').insert({ user_id:currentUser.id, house:addr.house, area:addr.area, city:addr.city, pin:addr.pin });
  }
  await sb.from('profiles').upsert({ id:currentUser.id, name:addr.name, phone:addr.phone }, { onConflict:'id' });
}

async function loadAddressFromDB() {
  if (!currentUser) return;
  const [{ data: addrData }, { data: profData }] = await Promise.all([
    sb.from('addresses').select('*').eq('user_id', currentUser.id).single(),
    sb.from('profiles').select('name,phone').eq('id', currentUser.id).single()
  ]);
  if (addrData) {
    savedAddress.house = addrData.house || '';
    savedAddress.area  = addrData.area  || 'Karawal Nagar';
    savedAddress.city  = addrData.city  || '';
    savedAddress.pin   = addrData.pin   || '';
  }
  if (profData) {
    savedAddress.name  = profData.name  || currentUser?.user_metadata?.full_name || '';
    savedAddress.phone = profData.phone || '';
  }
  const short = savedAddress.area || savedAddress.city;
  const sm = document.getElementById('prof-addr-small');
  if (sm && short) sm.textContent = short + (savedAddress.city ? ', '+savedAddress.city : '');
}


function sn(n){return n.length>11?n.slice(0,10)+'…':n;}


const ICONS = {
  all:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M8 6h4l-1 16h10l1.5-10H11" stroke="#222" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6H5" stroke="#222" stroke-width="2" stroke-linecap="round"/><circle cx="13" cy="25" r="2" fill="#222"/><circle cx="21" cy="25" r="2" fill="#222"/><rect x="14" y="8" width="8" height="10" rx="1" stroke="#222" stroke-width="1.5"/></svg>`,
  loose:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect x="10" y="12" width="16" height="18" rx="3" fill="#f5e6c8" stroke="#c8a86b" stroke-width="2"/><path d="M10 16 Q18 13 26 16" stroke="#c8a86b" stroke-width="2" fill="none"/><path d="M13 12 Q14 7 18 7 Q22 7 23 12" stroke="#c8a86b" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="13" y="18" width="10" height="2" rx="1" fill="#c8a86b"/><rect x="13" y="22" width="7" height="2" rx="1" fill="#c8a86b"/><text x="18" y="10" text-anchor="middle" font-size="5" fill="#e00" font-weight="bold">OPEN</text></svg>`,
  biscuits:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect x="8" y="10" width="20" height="20" rx="3" fill="#d4edda" stroke="#5a9a5a" stroke-width="2"/><rect x="8" y="10" width="20" height="7" rx="3" fill="#5a9a5a"/><text x="18" y="17" text-anchor="middle" font-size="5.5" fill="#fff" font-weight="900">BISCUIT</text><circle cx="18" cy="23" r="4" fill="#fff" stroke="#5a9a5a" stroke-width="1.5"/><circle cx="18" cy="23" r="2" fill="#c8a86b"/><line x1="18" y1="19" x2="18" y2="27" stroke="#5a9a5a" stroke-width="0.8"/><line x1="14" y1="23" x2="22" y2="23" stroke="#5a9a5a" stroke-width="0.8"/></svg>`,
  chips:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M13 5 Q12 9 10 12 L9 26 Q9 29 18 29 Q27 29 27 26 L26 12 Q24 9 23 5 Z" fill="#f5c842" stroke="#e0a800" stroke-width="1.8"/><path d="M13 5 Q14 7.5 18 7.5 Q22 7.5 23 5" fill="#e0a800"/><path d="M10 12 Q18 15 26 12" fill="#e0a800" stroke="#e0a800" stroke-width="1.2"/><text x="18" y="20" text-anchor="middle" font-size="5" fill="#8B4513" font-weight="900">SNACKS</text><text x="18" y="26" text-anchor="middle" font-size="4" fill="#8B4513" font-weight="700">88</text></svg>`,
  chocolate:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect x="6" y="10" width="24" height="18" rx="3" fill="#5d3a1a" stroke="#3d2000" stroke-width="1.5"/><rect x="9" y="13" width="6" height="5" rx="1" fill="#7a4a22" stroke="#3d2000" stroke-width="0.8"/><rect x="16" y="13" width="6" height="5" rx="1" fill="#7a4a22" stroke="#3d2000" stroke-width="0.8"/><rect x="9" y="19.5" width="6" height="5" rx="1" fill="#7a4a22" stroke="#3d2000" stroke-width="0.8"/><rect x="16" y="19.5" width="6" height="5" rx="1" fill="#7a4a22" stroke="#3d2000" stroke-width="0.8"/><rect x="23" y="13" width="4" height="11.5" rx="1" fill="#7a4a22" stroke="#3d2000" stroke-width="0.8"/></svg>`,
  stationery:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><g transform="rotate(-15 18 18)"><rect x="16" y="5" width="4" height="20" rx="1" fill="#f5c842" stroke="#e0a800" stroke-width="1"/><polygon points="16,25 20,25 18,30" fill="#e87722"/><rect x="16" y="5" width="4" height="4" rx="0.5" fill="#ccc" stroke="#999" stroke-width="0.8"/></g><g transform="rotate(0 18 18)"><rect x="15" y="4" width="4" height="20" rx="1" fill="#e87722" stroke="#c05a00" stroke-width="1"/><polygon points="15,24 19,24 17,30" fill="#fc0"/><rect x="15" y="4" width="4" height="4" rx="0.5" fill="#ccc" stroke="#999" stroke-width="0.8"/></g><g transform="rotate(15 18 18)"><rect x="14" y="5" width="4" height="20" rx="1" fill="#4a90d9" stroke="#2060a0" stroke-width="1"/><polygon points="14,25 18,25 16,30" fill="#888"/><rect x="14" y="5" width="4" height="4" rx="0.5" fill="#ccc" stroke="#999" stroke-width="0.8"/></g></svg>`,
  noodles:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect x="9" y="14" width="18" height="16" rx="3" fill="#fff3b0" stroke="#e0c050" stroke-width="2"/><rect x="9" y="14" width="18" height="7" rx="3" fill="#e05050"/><text x="18" y="20" text-anchor="middle" font-size="5" fill="#fff" font-weight="900">MAGGI</text><path d="M13 24 Q15 22 17 24 Q19 26 21 24 Q23 22 25 24" stroke="#c8a820" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M13 27 Q15 25 17 27 Q19 29 21 27 Q23 25 25 27" stroke="#c8a820" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`,
  drinks:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect x="10" y="10" width="16" height="20" rx="2" fill="#d4edda" stroke="#5a9a5a" stroke-width="1.8"/><rect x="10" y="10" width="16" height="8" rx="2" fill="#5a9a5a"/><rect x="13" y="7" width="5" height="4" rx="1" fill="#ccc" stroke="#999" stroke-width="1"/><line x1="15.5" y1="7" x2="15.5" y2="5" stroke="#999" stroke-width="1.5" stroke-linecap="round"/><circle cx="18" cy="23" r="4" fill="#90EE90" stroke="#5a9a5a" stroke-width="1"/><path d="M16 23 Q17 21 18 23 Q19 25 20 23" stroke="#5a9a5a" stroke-width="1" fill="none"/></svg>`,
  dairy:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><rect x="11" y="14" width="14" height="16" rx="2" fill="#fff" stroke="#ccc" stroke-width="1.8"/><path d="M11 14 L14 8 L22 8 L25 14" fill="#e8f4ff" stroke="#ccc" stroke-width="1.5"/><path d="M14 8 L18 12 L22 8" fill="#fff" stroke="#ccc" stroke-width="1"/><text x="18" y="24" text-anchor="middle" font-size="4.5" fill="#1565c0" font-weight="900">AMUL</text><rect x="13" y="26" width="10" height="2" rx="0.5" fill="#e8c940"/></svg>`,
  namkeen:`<svg width="36" height="36" viewBox="0 0 36 36" fill="none"><path d="M12 8 Q11 12 10 16 L10 28 Q10 30 18 30 Q26 30 26 28 L26 16 Q25 12 24 8 Z" fill="#ffd280" stroke="#e0a800" stroke-width="1.8"/><path d="M12 8 Q13 11 18 11 Q23 11 24 8" fill="#e0a800"/><path d="M10 16 Q18 19 26 16" stroke="#e0a800" stroke-width="1.2"/><text x="18" y="22" text-anchor="middle" font-size="4.5" fill="#7a3500" font-weight="900">NAMKEEN</text></svg>`,
};

const CATS = [
  {id:'all',          l:'All',           e:'🛍️', img:'images/all.png'},
  {id:'loose_item',   l:'LOOSE ITEM',    e:'🧂', img:'images/loose.png'},
  {id:'packed_item',  l:'PACKED ITEM',   e:'📦', img:'images/packeditem.png'},
  {id:'biscuits',     l:'BISCUITS',      e:'🍪', img:'images/biscuit.png'},
  {id:'chips',        l:'CHIPS',         e:'🥔', img:'images/snack.png'},
  {id:'chocolate',    l:'CHOCOLATE',     e:'🍫', img:'images/choco.png'},
  {id:'stationery',   l:'STATIONERY',    e:'✏️', img:'images/stationery.png'},
  {id:'noodles',      l:'NOODLES',       e:'🍜', img:'images/noodles.png'},
  {id:'drinks',       l:'COLD DRINKS',   e:'🥤', img:'images/drink.png'},
  {id:'dairy',        l:'DAIRY',         e:'🥛', img:'images/dairy.png'},
  {id:'namkeen',      l:'NAMKEEN',       e:'🫘', img:'images/namkeen.png'},
  {id:'personal_care',l:'PERSONAL CARE', e:'🧴', img:'images/personalcare.png'},
  {id:'beauty',       l:'BEAUTY',        e:'💄', img:'images/cream.png'},
];

const BANNERS = [

  {bg:'linear-gradient(135deg,#ff6b9d 0%,#ffb347 100%)', type:'brand'},
 {bg:'linear-gradient(135deg,#6a11cb 0%,#2575fc 100%)', type:'p', badge:'🌸 Women’s Care',   title:'Priority\nDelivery',       sub:'₹0 Delivery Charge · Essential products · Delivered with priority',       cta:'Shop Now', emoji:'👩🏻'},
  {bg:'linear-gradient(135deg,#f7971e 0%,#ffd200 100%)', type:'p', badge:'⚡ Express Delivery', title:'Deliver in\n4 Minutes!', sub:'Fresh groceries at your doorstep 🛵', cta:'Order Now', emoji:'⚡'},
  {bg:'linear-gradient(135deg,#fc4a1a 0%,#f7b733 100%)', type:'p', badge:'🔥 LIMITED OFFER',   title:'Flat 30% OFF',            sub:'Code: GROX30 — First 3 orders!',        cta:'Grab Now', emoji:'🎁'},
 
  
];

const BC = {POPULAR:'#1565c0',BESTSELLER:'#e65100',SALE:'#c62828',NEW:'#7b1fa2',HOT:'#b71c1c',FRESH:'#2e7d32'};

const P = [
  {id:1,  name:'Maggie Noodles',        brand:'Nestlé',       price:14,  mrp:14,  w:'70g',     cat:'noodles',    e:'🍜', b:'POPULAR',img:'images/maggie.png'},
  {id:2,  name:'Yippee Masala',        brand:'Sunfeast',     price:12,  mrp:14,  w:'70g',     cat:'noodles',    e:'🍝', b:'SALE',img:'images/yippe.png'},
  {id:3,  name:'Top Ramen',            brand:'Nissin',       price:12,  mrp:14,  w:'70g',     cat:'noodles',    e:'🫕', b:null,img:'images/ramen.png'},
  {id:4,  name:"Lays Salted",         brand:'PepsiCo',      price:20,  mrp:20,  w:'26g',     cat:'chips',      e:'🥔', b:'BESTSELLER',img:'images/lays.png'},
  {id:5,  name:'Kurkure Masala',       brand:'PepsiCo',      price:10,  mrp:10,  w:'22g',     cat:'chips',      e:'🌽', b:'POPULAR',img:'images/kurkure.png'},
  {id:6,  name:'Doritos Cheese',       brand:'Frito-Lay',    price:30,  mrp:35,  w:'30g',     cat:'chips',      e:'🧀', b:'SALE',img:'images/doritos.png'},
  {id:7,  name:'Coca-Cola',            brand:'Coca-Cola',    price:40,  mrp:45,  w:'500ml',   cat:'drinks',     e:'🥤', b:'BESTSELLER',img:'images/coca.png'},
  {id:8,  name:'Pepsi',                brand:'PepsiCo',      price:40,  mrp:45,  w:'500ml',   cat:'drinks',     e:'🫙', b:'NEW',img:'images/pepsi.png'},
  {id:9,  name:'Sprite',               brand:'Coca-Cola',    price:40,  mrp:45,  w:'500ml',   cat:'drinks',     e:'🍋',  b:'BESTSELLER',img:'images/lays.png'},
  {id:10, name:'Thums Up',             brand:'Coca-Cola',    price:40,  mrp:45,  w:'500ml',   cat:'drinks',     e:'👍', b:'HOT',img:'images/thumsup.png'},
  {id:11, name:'Limca',                brand:'Coca-Cola',    price:35,  mrp:40,  w:'500ml',   cat:'drinks',     e:'🍈', b:null,img:'images/limca.png'},
  {id:12, name:'Mountain Dew',         brand:'PepsiCo',      price:38,  mrp:45,  w:'500ml',   cat:'drinks',     e:'🟢', b:'SALE',img:'images/dew.png'},
  {id:13, name:'Parle-G',              brand:'Parle',        price:10,  mrp:10,  w:'100g',    cat:'biscuits',   e:'🍪', b:'BESTSELLER',img:'images/parleg.png'},
  {id:14, name:'Oreo',                 brand:'Cadbury',      price:20,  mrp:20,  w:'120g',    cat:'biscuits',   e:'⚫', b:'POPULAR',img:'images/oreo.png'},
  {id:15, name:'Bourbon',              brand:'Britannia',    price:20,  mrp:22,  w:'150g',    cat:'biscuits',   e:'🟫', b:null,img:'images/bourbon.png'},
  {id:16, name:'Marie Gold',           brand:'Britannia',    price:20,  mrp:22,  w:'200g',    cat:'biscuits',   e:'🌟', b:null,img:'images/marie.png'},
  {id:17, name:'Dairy Milk Silk',      brand:'Cadbury',      price:99,  mrp:110, w:'60g',     cat:'chocolate',  e:'🍫', b:'POPULAR',img:'images/silk.png'},
  {id:18, name:'KitKat',               brand:'Nestlé',       price:40,  mrp:40,  w:'41.5g',   cat:'chocolate',  e:'🍬', b:null,img:'images/kitkat.png'},
  {id:19, name:'5 Star',               brand:'Cadbury',      price:20,  mrp:20,  w:'40g',     cat:'chocolate',  e:'⭐', b:'HOT',img:'images/star.png'},
  {id:20, name:'Munch',                brand:'Nestlé',       price:10,  mrp:10,  w:'26.6g',   cat:'chocolate',  e:'🌰', b:null,img:'images/munch.png'},
  {id:21, name:'Amul Milk',            brand:'Amul',         price:31,  mrp:31,  w:'500ml',   cat:'dairy',      e:'🥛', b:null,img:'images/milk.png'},
  {id:22, name:'Mother Dairy Curd',    brand:'Mother Dairy', price:55,  mrp:60,  w:'400g',    cat:'dairy',      e:'🫙', b:'FRESH',img:'images/curd.png'},
  {id:23, name:'Amul Butter',          brand:'Amul',         price:56,  mrp:60,  w:'100g',    cat:'dairy',      e:'🧈', b:null,img:'images/butter.png'},
  {id:24, name:"Haldiram's Bhujia",    brand:"Haldiram's",   price:30,  mrp:30,  w:'150g',    cat:'namkeen',    e:'🫘', b:'POPULAR',img:'images/bhujia.png'},
  {id:25, name:'Bikaji Khatta Meetha', brand:'Bikaji',       price:25,  mrp:28,  w:'200g',    cat:'namkeen',    e:'🌶️',b:'SALE',img:'images/meetha.png'},
  {id:26, name:"Haldiram's Mixture",   brand:"Haldiram's",   price:30,  mrp:30,  w:'150g',    cat:'namkeen',    e:'🎑', b:null,img:'images/mix.png'},
  {id:27, name:'Tata Salt',            brand:'Tata',         price:22,  mrp:25,  w:'1kg',     cat:'loose_item', e:'🧂', b:null,img:'images/salt.png',
    variants:[{w:'500g',price:12,mrp:14},{w:'1 kg',price:22,mrp:25},{w:'2 kg',price:42,mrp:48}]},
  {id:28, name:'Aashirvaad Atta',      brand:'ITC',          price:260, mrp:280, w:'5kg',     cat:'loose_item', e:'🌾', b:'BESTSELLER',img:'images/atta.png',
    variants:[{w:'1 kg',price:60,mrp:65},{w:'5 kg',price:260,mrp:280},{w:'10 kg',price:490,mrp:540}]},
  {id:29, name:'Sunflower Oil',        brand:'Saffola',      price:145, mrp:165, w:'1L',      cat:'loose_item', e:'🫙', b:'SALE',img:'images/oil.png',
    variants:[{w:'500 ml',price:75,mrp:85},{w:'1 L',price:145,mrp:165},{w:'2 L',price:280,mrp:320}]},
  {id:30, name:'Classmate Notebook',   brand:'ITC',          price:45,  mrp:50,  w:'172pgs',  cat:'stationery', e:'📓', b:null,img:'images/copy.png'},
  {id:31, name:'Reynolds Pen',         brand:'Reynolds',     price:10,  mrp:10,  w:'Pack 5',  cat:'stationery', e:'✒️',b:'POPULAR',img:'images/pen.png'},
  {id:32, name:'Apsara Pencils',       brand:'Apsara',       price:30,  mrp:35,  w:'Pack 10', cat:'stationery', e:'✏️',b:null,img:'images/pencil.png'},
  {id:33, name:'Surf Excel',           brand:'HUL',          price:55,  mrp:60,  w:'500g',    cat:'packed_item',  e:'🧺', b:'POPULAR', img:'images/surf.png'},
  {id:34, name:'Ariel Powder',         brand:'P&G',          price:50,  mrp:55,  w:'500g',    cat:'packed_item',  e:'🫧', b:null,img:'images/washing.png'},
  {id:35, name:'Vim Bar',              brand:'HUL',          price:15,  mrp:15,  w:'200g',    cat:'packed_item',  e:'🟩', b:null,img:'images/vim.png'},
  {id:36, name:'Dettol Soap',          brand:'Dettol',       price:45,  mrp:50,  w:'75g',     cat:'personal_care', e:'🧼', b:'POPULAR', img:'images/dettol.png'},
  {id:37, name:'Colgate Toothpaste',   brand:'Colgate',      price:65,  mrp:75,  w:'100g',    cat:'personal_care', e:'🦷', b:null, img:'images/colgate.png'},
  {id:38, name:'Clinic Plus Shampoo',  brand:'HUL',          price:85,  mrp:95,  w:'175ml',   cat:'personal_care', e:'🧴', b:null,      img:'images/shampoo.png'},
  {id:39, name:'Parachute Oil',        brand:'Marico',       price:95,  mrp:105, w:'200ml',   cat:'personal_care', e:'🫙', b:'POPULAR', img:'images/hairoil.png'},
  {id:40, name:'Lifebuoy Soap',        brand:'HUL',          price:30,  mrp:35,  w:'100g',    cat:'personal_care', e:'🧼', b:null,      img:'images/lifebuoy.png'},
  {id:41, name:'channa Dal',             brand:'Local',        price:120, mrp:130, w:'500g',    cat:'loose_item', e:'🟡', b:null,      img:'images/channadal.png',
    variants:[{w:'250 g',price:65,mrp:70},{w:'500 g',price:120,mrp:130},{w:'1 kg',price:230,mrp:250}]},
  {id:42, name:'Basmati Rice',         brand:'India Gate',   price:180, mrp:200, w:'1kg',     cat:'loose_item', e:'🍚', b:'BESTSELLER',img:'images/rice.png',
    variants:[{w:'500 g',price:95,mrp:105},{w:'1 kg',price:180,mrp:200},{w:'5 kg',price:850,mrp:950}]},
  {id:43, name:'Poha',                 brand:'Local',        price:45,  mrp:50,  w:'500g',    cat:'loose_item', e:'🌾', b:null,      img:'images/poha.png',
    variants:[{w:'250 g',price:25,mrp:28},{w:'500 g',price:45,mrp:50},{w:'1 kg',price:85,mrp:95}]},
  {id:44, name:'Suji / Rava',          brand:'Pillsbury',    price:40,  mrp:45,  w:'500g',    cat:'loose_item', e:'🌾', b:null,      img:'images/suji.png',
    variants:[{w:'250 g',price:22,mrp:25},{w:'500 g',price:40,mrp:45},{w:'1 kg',price:75,mrp:85}]},
  {id:45, name:'Besan',                brand:'Local',        price:65,  mrp:70,  w:'500g',    cat:'loose_item', e:'🟡', b:null,      img:'images/besan.png',
    variants:[{w:'250 g',price:35,mrp:38},{w:'500 g',price:65,mrp:70},{w:'1 kg',price:125,mrp:135}]},
  {id:46, name:'Mustard Seeds',        brand:'MDH',          price:25,  mrp:28,  w:'100g',    cat:'loose_item', e:'🟤', b:null,      img:'images/yellowmustard.png',
    variants:[{w:'100 g',price:25,mrp:28},{w:'200 g',price:48,mrp:54},{w:'500 g',price:115,mrp:130}]},
  {id:47, name:'Jeera',                brand:'Everest',      price:30,  mrp:35,  w:'100g',    cat:'loose_item', e:'🌿', b:null,      img:'images/jeera.png',
    variants:[{w:'100 g',price:30,mrp:35},{w:'200 g',price:58,mrp:65},{w:'500 g',price:140,mrp:160}]},
  {id:48, name:'Haldi Powder',         brand:'Everest',      price:35,  mrp:40,  w:'100g',    cat:'loose_item', e:'🟡', b:null,      img:'images/turmericpowder.png',
    variants:[{w:'100 g',price:35,mrp:40},{w:'200 g',price:68,mrp:78},{w:'500 g',price:160,mrp:185}]},
  {id:49, name:'Red Chilli Powder',    brand:'Everest',      price:35,  mrp:40,  w:'100g',    cat:'loose_item', e:'🌶️',b:null,      img:'images/redchilli.png',
    variants:[{w:'100 g',price:35,mrp:40},{w:'200 g',price:68,mrp:78},{w:'500 g',price:160,mrp:185}]},
  {id:50, name:'Coriander Powder',     brand:'MDH',          price:30,  mrp:35,  w:'100g',    cat:'loose_item', e:'🌿', b:null,      img:'images/coriander.png',
    variants:[{w:'100 g',price:30,mrp:35},{w:'200 g',price:58,mrp:65},{w:'500 g',price:138,mrp:158}]},
  {id:52, name:'Garam Masala',         brand:'MDH',          price:45,  mrp:50,  w:'100g',    cat:'loose_item', e:'🫙', b:'POPULAR', img:'images/garam.png',
    variants:[{w:'100 g',price:45,mrp:50},{w:'200 g',price:88,mrp:98},{w:'500 g',price:210,mrp:240}]},
  {id:53, name:'Frooti Mango',         brand:'Parle Agro',   price:20,  mrp:20,  w:'200ml',   cat:'drinks',     e:'🥭', b:'POPULAR', img:'images/frooti.png'},
  {id:54, name:'Maaza',                brand:'Coca-Cola',    price:20,  mrp:20,  w:'250ml',   cat:'drinks',     e:'🥭', b:null,      img:'images/maaza.png'},
  {id:55, name:'Real Juice',           brand:'Dabur',        price:85,  mrp:95,  w:'1L',      cat:'drinks',     e:'🧃', b:null,      img:'images/realjuice.png'},
  {id:56, name:'Sting Energy',         brand:'PepsiCo',      price:30,  mrp:30,  w:'250ml',   cat:'drinks',     e:'⚡', b:'HOT',     img:'images/sting.png'},
  {id:57, name:'Minute Maid',          brand:'Coca-Cola',    price:20,  mrp:20,  w:'200ml',   cat:'drinks',     e:'🍊', b:null,      img:'images/minute.png'},
  {id:58, name:'Hide & Seek',          brand:'Parle',        price:30,  mrp:30,  w:'100g',    cat:'biscuits',   e:'🍪', b:'POPULAR', img:'images/hide&seek.png'},
  {id:59, name:'Good Day',             brand:'Britannia',    price:30,  mrp:30,  w:'150g',    cat:'biscuits',   e:'☀️', b:null,      img:'images/goodday.png'},
  {id:60, name:'Digestive',            brand:'McVities',     price:55,  mrp:60,  w:'200g',    cat:'biscuits',   e:'🍪', b:null,      img:'images/digestive.png'},
  {id:61, name:'Cream Cracker',        brand:'Britannia',    price:25,  mrp:28,  w:'100g',    cat:'biscuits',   e:'🫓', b:null,      img:'images/cream.png'},
  {id:62, name:'Perk Chocolate',       brand:'Cadbury',      price:10,  mrp:10,  w:'13g',     cat:'chocolate',  e:'🍫', b:null,      img:'images/perk.png'},
  {id:63, name:'Gems',                 brand:'Cadbury',      price:10,  mrp:10,  w:'15g',     cat:'chocolate',  e:'🟡', b:'POPULAR', img:'images/jems.png'},
  {id:64, name:'Milkybar',             brand:'Nestlé',       price:20,  mrp:20,  w:'18g',     cat:'chocolate',  e:'🤍', b:null,      img:'images/milkybar.png'},
  {id:65, name:'Eclairs',              brand:'Cadbury',      price:5,   mrp:5,   w:'10g',     cat:'chocolate',  e:'🍬', b:null,      img:'images/eclairs.png'},
  {id:66, name:'Uncle Chipps',         brand:'PepsiCo',      price:10,  mrp:10,  w:'22g',     cat:'chips',      e:'🥔', b:null,      img:'images/unclechips.png'},
  {id:67, name:'Bingo Mad Angles',     brand:'ITC',          price:20,  mrp:20,  w:'37g',     cat:'chips',      e:'📐', b:'HOT',     img:'images/bingo.png'},
  {id:68, name:'Pringles',             brand:'Kelloggs',     price:99,  mrp:110, w:'107g',    cat:'chips',      e:'🥔', b:'NEW',     img:'images/pringles.png'},
  {id:69, name:'Cornitos Nachos',      brand:'Cornitos',     price:30,  mrp:35,  w:'55g',     cat:'chips',      e:'🌽', b:null,      img:'images/nachos.png'},
  {id:70, name:'Amul Lassi',           brand:'Amul',         price:30,  mrp:30,  w:'200ml',   cat:'dairy',      e:'🥛', b:'POPULAR', img:'images/lassi.png'},
  {id:71, name:'Amul Cheese',          brand:'Amul',         price:55,  mrp:60,  w:'100g',    cat:'dairy',      e:'🧀', b:null,      img:'images/cheese.png'},
  {id:72, name:'Amul Ice Cream',       brand:'Amul',         price:45,  mrp:45,  w:'125ml',   cat:'dairy',      e:'🍦', b:'POPULAR', img:'images/icecream.png'},
  {id:73, name:'Sev',                  brand:"Haldiram's",   price:30,  mrp:30,  w:'150g',    cat:'namkeen',    e:'🌀', b:null,      img:'images/aloosev.png'},
  {id:74, name:'Mong Dal Namkeen',    brand:"Haldiram's",   price:30,  mrp:35,  w:'150g',    cat:'namkeen',    e:'🟡', b:null,      img:'images/mongdalsev.png'},
  {id:75, name:'Aloo Bhujia',          brand:'Bikaji',       price:25,  mrp:28,  w:'200g',    cat:'namkeen',    e:'🥔', b:'POPULAR', img:'images/aloobhujia.png'},
  {id:76, name:'Knorr Soup',           brand:'HUL',          price:35,  mrp:40,  w:'42g',     cat:'noodles',    e:'🍲', b:null,      img:'images/knorr.png'},
  {id:77, name:'Wai Wai Noodles',      brand:'CG Foods',     price:15,  mrp:15,  w:'75g',     cat:'noodles',    e:'🍜', b:null,      img:'images/waiwai.png'},
  {id:78, name:'Atta Noodles',         brand:'Nestlé',       price:14,  mrp:14,  w:'70g',     cat:'noodles',    e:'🍝', b:null,      img:'images/attamaggie.png'},
  {id:79, name:'Classmate Pen',        brand:'ITC',          price:15,  mrp:15,  w:'Pack 5',  cat:'stationery', e:'🖊️',b:null,      img:'images/classpen.png'},
  {id:80, name:'Fevicol',              brand:'Pidilite',     price:25,  mrp:28,  w:'50g',     cat:'stationery', e:'🔧', b:null,      img:'images/fevicol.png'},
  {id:81, name:'Stapler',              brand:'Kangaro',      price:85,  mrp:95,  w:'1 pc',    cat:'stationery', e:'📎', b:null,      img:'images/stapler.png'},
  {id:82, name:'Eraser',               brand:'doms',         price:50,  mrp:60,  w:'5pc',     cat:'stationery', e:'📎', b:null,      img:'images/eraser.png'},
  /* BEAUTY */
  {id:83, name:'Nivea Face Cream',     brand:'Nivea',        price:89,  mrp:99,  w:'50ml',    cat:'beauty',     e:'🫙', b:'POPULAR', img:'images/cream.png'},
  {id:84, name:'Fair & Lovely',        brand:'HUL',          price:65,  mrp:75,  w:'50g',     cat:'beauty',     e:'✨', b:null,      img:'images/cream.png'},
  {id:85, name:'Vaseline Lotion',      brand:'HUL',          price:120, mrp:135, w:'200ml',   cat:'beauty',     e:'🧴', b:'NEW',     img:'images/cream.png'},
  {id:86, name:'Lakme Lip Color',      brand:'Lakme',        price:175, mrp:199, w:'1 pc',    cat:'beauty',     e:'💄', b:'POPULAR', img:'images/cream.png'},
  {id:87, name:'Maybelline Kajal',     brand:'Maybelline',   price:150, mrp:175, w:'1 pc',    cat:'beauty',     e:'👁️', b:'BESTSELLER',img:'images/cream.png'},
  {id:88, name:'Himalaya Face Wash',   brand:'Himalaya',     price:75,  mrp:85,  w:'100ml',   cat:'beauty',     e:'🫧', b:null,      img:'images/cream.png'},

  // ══════════════════════════════════════════
  // ADD YOUR 100 PRODUCTS BELOW (id 101–200)
  // Fill: name, brand, price, mrp, w, img
  // cats: noodles/chips/biscuits/chocolate/drinks/dairy/namkeen/loose_item/packed_item/stationery/personal_care/beauty
  // ══════════════════════════════════════════
  {id:101,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 101
  {id:102,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 102
  {id:103,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 103
  {id:104,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 104
  {id:105,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 105
  {id:106,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 106
  {id:107,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 107
  {id:108,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 108
  {id:109,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 109
  {id:110,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 110
  {id:111,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 111
  {id:112,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 112
  {id:113,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 113
  {id:114,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 114
  {id:115,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 115
  {id:116,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 116
  {id:117,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 117
  {id:118,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 118
  {id:119,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 119
  {id:120,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 120
  {id:121,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 121
  {id:122,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 122
  {id:123,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 123
  {id:124,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 124
  {id:125,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 125
  {id:126,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 126
  {id:127,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 127
  {id:128,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 128
  {id:129,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 129
  {id:130,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 130
  {id:131,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 131
  {id:132,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 132
  {id:133,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 133
  {id:134,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 134
  {id:135,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 135
  {id:136,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 136
  {id:137,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 137
  {id:138,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 138
  {id:139,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 139
  {id:140,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 140
  {id:141,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 141
  {id:142,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 142
  {id:143,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 143
  {id:144,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 144
  {id:145,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 145
  {id:146,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 146
  {id:147,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 147
  {id:148,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 148
  {id:149,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 149
  {id:150,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 150
  {id:151,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 151
  {id:152,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 152
  {id:153,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 153
  {id:154,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 154
  {id:155,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 155
  {id:156,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 156
  {id:157,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 157
  {id:158,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 158
  {id:159,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 159
  {id:160,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 160
  {id:161,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 161
  {id:162,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 162
  {id:163,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 163
  {id:164,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 164
  {id:165,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 165
  {id:166,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 166
  {id:167,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 167
  {id:168,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 168
  {id:169,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 169
  {id:170,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 170
  {id:171,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 171
  {id:172,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 172
  {id:173,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 173
  {id:174,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 174
  {id:175,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 175
  {id:176,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 176
  {id:177,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 177
  {id:178,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 178
  {id:179,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 179
  {id:180,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 180
  {id:181,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 181
  {id:182,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 182
  {id:183,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 183
  {id:184,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 184
  {id:185,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 185
  {id:186,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 186
  {id:187,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 187
  {id:188,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 188
  {id:189,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'drinks',  e:'🥤',  b:null,  img:''},  // Product 189
  {id:190,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'dairy',  e:'🥛',  b:null,  img:''},  // Product 190
  {id:191,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'namkeen',  e:'🫘',  b:null,  img:''},  // Product 191
  {id:192,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'loose_item',  e:'🧂',  b:null,  img:''},  // Product 192
  {id:193,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'packed_item',  e:'🧺',  b:null,  img:''},  // Product 193
  {id:194,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'stationery',  e:'📓',  b:null,  img:''},  // Product 194
  {id:195,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'personal_care',  e:'🧴',  b:null,  img:''},  // Product 195
  {id:196,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'beauty',  e:'💄',  b:null,  img:''},  // Product 196
  {id:197,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'noodles',  e:'🍜',  b:null,  img:''},  // Product 197
  {id:198,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chips',  e:'🥔',  b:null,  img:''},  // Product 198
  {id:199,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'biscuits',  e:'🍪',  b:null,  img:''},  // Product 199
  {id:200,  name:'',  brand:'',  price:0,  mrp:0,  w:'',  cat:'chocolate',  e:'🍫',  b:null,  img:''},  // Product 200
];

// bestsellers shown on home page
const BESTSELLERS = [13,17,7,4,23,1,18,24,21,28,2,14];

let cart={}, curPage='home', curCat='all', sq='', bi=0;

/* STRIP */
function buildStrip(){
  document.getElementById('csi').innerHTML=CATS.map((c,i)=>
    `<button class="cat-btn${i===0?' first':''}${curCat===c.id?' active':''}" onclick="selCat('${c.id}')">
      <img src="${c.img}" style="width:36px;height:36px;object-fit:contain;">
      <span class="cl">${c.l}</span>
    </button>`).join('');
}
/* LOOSE ITEM SUBCATEGORIES */
const LOOSE_SUBS = [
  {id:'all_loose', l:'All'},
  {id:'oil',       l:'🫙 Oil'},
  {id:'spices',    l:'🌶️ Spices'},
  {id:'atta',      l:'🌾 Atta & Flours'},
  {id:'rice',      l:'🍚 Rice & Grains'},
  {id:'dryfruits', l:'🥜 Dry Fruits'},
];
const LOOSE_SUB_MAP = {
  oil:       [29],                     // Sunflower Oil
  spices:    [46,47,48,49,50,52],      // Mustard, Jeera, Haldi, RedChilli, Coriander, Garam
  atta:      [28,43,44,45],            // Atta, Poha, Suji, Besan
  rice:      [42,41,27],              // Rice, Channa Dal, Salt
  dryfruits: [],
};
let curLooseSub = 'all_loose';

const PACKED_SUBS = [
  {id:'all_packed',  l:'All'},
  {id:'oil_p',       l:'🫙 Oil'},
  {id:'spices_p',    l:'🌶️ Spices'},
  {id:'atta_p',      l:'🌾 Atta & Flours'},
  {id:'rice_p',      l:'🍚 Rice & Grains'},
  {id:'detergent',   l:'🧺 Detergent'},
  {id:'dishwash',    l:'🟩 Dishwash'},
  {id:'personal',    l:'🧴 Personal Care'},
];
let curPackedSub = 'all_packed';

function selCat(id){
  curCat=id;
  curLooseSub='all_loose';
  curPackedSub='all_packed';
  buildStrip();
  if(id==='all'){
    buildBestsellers();
    return;
  }
  // Show products inline on home with subcategory bar for loose/packed
  if(id==='loose_item'){
    renderLooseSection();
    return;
  }
  if(id==='packed_item'){
    renderPackedSection();
    return;
  }
  // Other categories
  const filtered=P.filter(p=>p.cat===id);
  document.getElementById('pgrid-home').innerHTML=filtered.map(p=>{
    const qty=cart[p.id]||0;
    return`<div class="pc-card fia" data-pid="${p.id}">
      ${p.img?`<img src="${p.img}" style="width:72px;height:72px;object-fit:contain;border-radius:8px;margin-bottom:6px;">`:`<div class="pc-emoji">${p.e}</div>`}
      <div class="pc-name">${sn(p.name)}</div>
      <div class="pc-weight">${p.w}</div>
      <div class="pc-bot">
        <span class="pc-price">₹${p.price}</span>
        <div class="pc-bot-right">${qty===0
          ?`<button class="pc-add-btn" onclick="ac(${p.id})">+</button>`
          :`<div class="pc-qc"><button onclick="rc(${p.id})">−</button><span>${qty}</span><button onclick="ac(${p.id})">+</button></div>`}</div>
      </div>
    </div>`;
  }).join('');
}

function renderLooseSection(){
  const subBar=`<div class="loose-sub-bar" id="loose-sub-bar">
    ${LOOSE_SUBS.map(s=>`<button class="lsb-btn${curLooseSub===s.id?' lsb-active':''}" onclick="selLooseSub('${s.id}')">${s.l}</button>`).join('')}
  </div>`;
  let items;
  if(curLooseSub==='all_loose'){
    items=P.filter(p=>p.cat==='loose_item');
  } else {
    const ids=LOOSE_SUB_MAP[curLooseSub]||[];
    items=ids.length?P.filter(p=>ids.includes(p.id)):P.filter(p=>p.cat==='loose_item');
  }
  const cards=items.map(p=>{
    // Calculate rate per kg for display
    let rateDisplay='';
    let ratePerKg=0;
    if(p.variants&&p.variants.length>0){
      const v1kg=p.variants.find(v=>v.w==='1 kg'||v.w==='1kg');
      const ref=v1kg||p.variants[0];
      const wStr=ref.w.toLowerCase().replace(' ','');
      let grams=0;
      if(wStr.endsWith('kg')) grams=parseFloat(wStr)*1000;
      else if(wStr.endsWith('ml')) grams=parseFloat(wStr);
      else if(wStr.endsWith('l')) grams=parseFloat(wStr)*1000;
      else grams=parseFloat(wStr);
      ratePerKg=grams>0?(ref.price/grams*1000):ref.price;
      rateDisplay=`₹${Math.round(ratePerKg)}/kg`;
    } else {
      rateDisplay=`₹${p.price}`;
    }
    return`<div class="pc-card lc-card fia" data-pid="${p.id}" style="cursor:pointer">
      ${p.img?`<img src="${p.img}" style="width:72px;height:72px;object-fit:contain;border-radius:8px;margin-bottom:6px;">`:`<div class="pc-emoji">${p.e}</div>`}
      <div class="pc-name">${sn(p.name)}</div>
      <div class="pc-weight">${p.brand}</div>
      <div class="pc-bot" style="margin-top:auto">
        <span class="pc-price">${rateDisplay}</span>
        <div class="pc-bot-right"><button class="pc-add-btn" onclick="openCustomWeight(${p.id})">+</button></div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('pgrid-home').innerHTML=subBar+`<div class="sub-prod-grid">${cards}</div>`;
}

/* CUSTOM WEIGHT MODAL */
let cwPid=null;
function openCustomWeight(pid){
  cwPid=pid;
  const p=P.find(x=>x.id===pid);
  if(!p) return;
  // calc rate per kg from variants or price
  let ratePerKg=0;
  let ratePerG=0;
  if(p.variants&&p.variants.length>0){
    const v1kg=p.variants.find(v=>v.w==='1 kg'||v.w==='1kg');
    const ref=v1kg||p.variants[0];
    const wStr=ref.w.toLowerCase().replace(' ','');
    let grams=0;
    if(wStr.endsWith('kg')) grams=parseFloat(wStr)*1000;
    else if(wStr.endsWith('ml')) grams=parseFloat(wStr);
    else if(wStr.endsWith('l')) grams=parseFloat(wStr)*1000;
    else grams=parseFloat(wStr);
    ratePerG=grams>0?(ref.price/grams):ref.price/1000;
    ratePerKg=ratePerG*1000;
  } else {
    const wStr=p.w.toLowerCase().replace(' ','');
    let grams=0;
    if(wStr.endsWith('kg')) grams=parseFloat(wStr)*1000;
    else if(wStr.endsWith('ml')) grams=parseFloat(wStr);
    else if(wStr.endsWith('l')) grams=parseFloat(wStr)*1000;
    else grams=parseFloat(wStr);
    ratePerG=grams>0?(p.price/grams):p.price/1000;
    ratePerKg=ratePerG*1000;
  }
  // Store on modal for calculation
  const modal=document.getElementById('cw-modal');
  modal.dataset.ratePerG=ratePerG;
  modal.dataset.pid=pid;
  const cwImgEl=document.getElementById('cw-img'); cwImgEl.style.display=''; cwImgEl.src=p.img||'';
  document.getElementById('cw-name').textContent=p.name;
  document.getElementById('cw-brand').textContent=p.brand;
  document.getElementById('cw-rate').textContent='₹'+Math.round(ratePerKg)+'/kg';
  document.getElementById('cw-input').value='';
  document.getElementById('cw-total').textContent='₹0';
  document.getElementById('cw-confirm').disabled=true;
  // default to kg
  document.querySelectorAll('.cw-unit-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.cw-unit-btn[data-unit="kg"]').classList.add('active');
  modal.dataset.unit='kg';
  modal.style.display='flex';
  setTimeout(()=>modal.classList.add('cw-open'),10);
  document.getElementById('cw-input').focus();
}
function closeCW(){
  const modal=document.getElementById('cw-modal');
  modal.classList.remove('cw-open');
  setTimeout(()=>{ modal.style.display='none'; },260);
}
function cwSetUnit(unit){
  const modal=document.getElementById('cw-modal');
  modal.dataset.unit=unit;
  document.querySelectorAll('.cw-unit-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.cw-unit-btn[data-unit="'+unit+'"]').classList.add('active');
  cwCalc();
}
function cwCalc(){
  const modal=document.getElementById('cw-modal');
  const val=parseFloat(document.getElementById('cw-input').value)||0;
  const unit=modal.dataset.unit;
  const ratePerG=parseFloat(modal.dataset.ratePerG)||0;
  const grams=unit==='kg'?val*1000:val;
  const total=Math.round(grams*ratePerG);
  document.getElementById('cw-total').textContent= val>0 ? '₹'+total : '₹0';
  document.getElementById('cw-confirm').disabled= val<=0;
}
function cwAddToCart(){
  const modal=document.getElementById('cw-modal');
  const val=parseFloat(document.getElementById('cw-input').value)||0;
  if(val<=0){ showToast('⚠️ Weight daalo pehle!'); return; }
  const unit=modal.dataset.unit;
  const pid=parseInt(modal.dataset.pid);
  const p=P.find(x=>x.id===pid);
  if(!p) return;
  const ratePerG=parseFloat(modal.dataset.ratePerG)||0;
  const grams=unit==='kg'?val*1000:val;
  const total=Math.round(grams*ratePerG);
  const wLabel=unit==='kg'?val+'kg':val+'g';
  const vid=pid*1000+Math.round(grams);
  if(!P.find(x=>x.id===vid)){
    P.push({id:vid, name:p.name+' ('+wLabel+')', brand:p.brand, price:total, mrp:total, w:wLabel, cat:'loose_item', e:p.e, b:null, img:p.img});
  }
  cart[vid]=(cart[vid]||0)+1;
  const b=document.getElementById('cbadge');
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  upCart();
  showToast('✅ '+p.name+' ('+wLabel+') — ₹'+total+' added!');
  closeCW();
}

function selLooseSub(id){
  curLooseSub=id;
  renderLooseSection();
}

function renderPackedSection(){
  const subBar=`<div class="loose-sub-bar" id="packed-sub-bar">
    ${PACKED_SUBS.map(s=>`<button class="lsb-btn${curPackedSub===s.id?' lsb-active':''}" onclick="selPackedSub('${s.id}')">${s.l}</button>`).join('')}
  </div>`;
  let items;
  if(curPackedSub==='oil_p')       items=P.filter(p=>p.id===29);
  else if(curPackedSub==='spices_p')    items=P.filter(p=>[46,47,48,49,50,52].includes(p.id));
  else if(curPackedSub==='atta_p')      items=P.filter(p=>[28,43,44,45].includes(p.id));
  else if(curPackedSub==='rice_p')      items=P.filter(p=>[42,41,27].includes(p.id));
  else if(curPackedSub==='detergent')   items=P.filter(p=>p.id===33||p.id===34);
  else if(curPackedSub==='dishwash')    items=P.filter(p=>p.id===35);
  else if(curPackedSub==='personal')    items=P.filter(p=>p.cat==='personal_care');
  else items=P.filter(p=>p.cat==='packed_item'||p.cat==='loose_item'||p.cat==='personal_care');
  const cards=items.map(p=>{
    const qty=cart[p.id]||0;
    return`<div class="pc-card fia" data-pid="${p.id}">
      ${p.img?`<img src="${p.img}" style="width:72px;height:72px;object-fit:contain;border-radius:8px;margin-bottom:6px;">`:`<div class="pc-emoji">${p.e}</div>`}
      <div class="pc-name">${sn(p.name)}</div>
      <div class="pc-weight">${p.w}</div>
      <div class="pc-bot">
        <span class="pc-price">₹${p.price}</span>
        <div class="pc-bot-right">${qty===0
          ?`<button class="pc-add-btn" onclick="ac(${p.id})">+</button>`
          :`<div class="pc-qc"><button onclick="rc(${p.id})">−</button><span>${qty}</span><button onclick="ac(${p.id})">+</button></div>`}</div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('pgrid-home').innerHTML=subBar+`<div class="sub-prod-grid">${cards}</div>`;
}

function selPackedSub(id){
  curPackedSub=id;
  renderPackedSection();
}

/* BANNER */
function buildBanner(){
  const b=BANNERS[bi];
  const s=document.getElementById('banner-slide');
  const d=document.getElementById('banner-dots');
  s.style.background=b.bg;
  d.style.background=b.bg;
  if(b.type==='brand'){
    s.innerHTML=`
      <div class="big-emoji">🛍️</div>
      <div class="brand-text"><span class="b1">Grocer</span><span class="b2">X</span><span class="b3">INDIA</span></div>
      <div class="brand-tag">Your neighbourhood kirana, online ⚡</div>`;
  } else {
    s.innerHTML=`
      <div class="big-emoji">${b.emoji}</div>
      <div class="badge-pill">${b.badge}</div>
      <h2>${b.title}</h2>
      <p>${b.sub}</p>
      <button class="cta-btn" onclick="showPage('products')">${b.cta} →</button>`;
  }
  d.innerHTML=BANNERS.map((_,i)=>`<button class="dot${i===bi?' active':''}" onclick="jb(${i})"></button>`).join('');
}
function jb(i){bi=i;buildBanner();}
setInterval(()=>{bi=(bi+1)%BANNERS.length;buildBanner();},3500);

/* BESTSELLERS on home */
function buildBestsellers(){
  const items=BESTSELLERS.map(id=>P.find(p=>p.id===id)).filter(Boolean);
  document.getElementById('pgrid-home').innerHTML=items.map(p=>{
    const qty=cart[p.id]||0;
    return`<div class="pc-card fia" data-pid="${p.id}">
      ${p.img ?`<img src="${p.img}"style="width:72px;height:72px;object-fit:contain;border-radius:8px;margin-bottom:6px;">`:`<div class="pc-emoji">${p.e}</div>`}
      <div class="pc-name">${sn(p.name)}</div>
      <div class="pc-weight">${p.w}</div>
      <div class="pc-bot">
        <span class="pc-price">₹${p.price}</span>
        <div class="pc-bot-right">${qty===0
          ?`<button class="pc-add-btn" onclick="ac(${p.id})">+</button>`
          :`<div class="pc-qc"><button onclick="rc(${p.id})">−</button><span>${qty}</span><button onclick="ac(${p.id})">+</button></div>`}</div>
      </div>
    </div>`;
  }).join('');
}

/* CATEGORY CARDS */
const CE={drinks:['🥤','🧃','🫙','🍶'],chips:['🥔','🌽','🧀'],biscuits:['🍪','🫓','🍞'],
  chocolate:['🍫','🍬','🍭'],noodles:['🍜','🍝','🥡'],dairy:['🥛','🧈','🫙'],
  namkeen:['🫘','🌶️','🥜'],loose_item:['🧂','🌾','🫙'],packed_item:['🧺','🟩','🫧'],
  stationery:['📓','✏️','🖊️'],personal_care:['🧴','🪥','🧼'],beauty:['💄','👁️','✨']};
function eg(cat,tall){
  const e=CE[cat]||['🛍️'];
  if(tall) return`<div class="cc-emojis-grid">${e.slice(0,4).map(x=>`<span>${x}</span>`).join('')}</div>`;
  return`<div class="cc-emojis">${e.slice(0,3).map(x=>`<span>${x}</span>`).join('')}</div>`;
}
function buildCards(){
  document.getElementById('cr1').innerHTML=`
    <div class="cc tall" onclick="selCat('drinks')">
      <h3>Cold Drinks & Juices</h3>
      <div class="cc-emojis-grid">
        <span><img src="images/coca.png" style="width:100%;height:100%;object-fit:contain;"></span>
        <span><img src="images/pepsi.png" style="width:100%;height:100%;object-fit:contain;"></span>
        <span><img src="images/dew.png" style="width:100%;height:100%;object-fit:contain;"></span>
        <span><img src="images/sprite.png" style="width:100%;height:100%;object-fit:contain;"></span>
      </div>
    </div>
    <div class="cc" onclick="selCat('chips')">
      <h3>Chips & Namkeen</h3>
      <div class="cc-emojis">
        <span><img src="images/lays.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/kurkure.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/doritos.png" style="width:40px;height:40px;object-fit:contain;"></span>
      </div>
    </div>
    <div class="cc" onclick="selCat('biscuits')">
      <h3>Biscuits & Bakery</h3>
      <div class="cc-emojis">
        <span><img src="images/parleg.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/oreo.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/marie.png" style="width:40px;height:40px;object-fit:contain;"></span>
      </div>
    </div>`;

  document.getElementById('cr2').innerHTML=`
    <div class="cc" onclick="selCat('chocolate')">
      <h3>Chocolates & Sweets</h3>
      <div class="cc-emojis">
        <span><img src="images/silk.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/kitkat.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/munch.png" style="width:40px;height:40px;object-fit:contain;"></span>
      </div>
    </div>
    <div class="cc" onclick="selCat('noodles')">
      <h3>Instant Food</h3>
      <div class="cc-emojis">
        <span><img src="images/maggie.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/yippe.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/ramen.png" style="width:40px;height:40px;object-fit:contain;"></span>
      </div>
    </div>`;

  document.getElementById('cr3').innerHTML=`
    <div class="cc" onclick="selCat('dairy')">
      <h3>Dairy & Eggs</h3>
      <div class="cc-emojis">
        <span><img src="images/milk.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/butter.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/curd.png" style="width:40px;height:40px;object-fit:contain;"></span>
      </div>
    </div>
    <div class="cc" onclick="selCat('namkeen')">
      <h3>Namkeen & Snacks</h3>
      <div class="cc-emojis">
        <span><img src="images/bhujia.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/meetha.png" style="width:40px;height:40px;object-fit:contain;"></span>
        <span><img src="images/mix.png" style="width:40px;height:40px;object-fit:contain;"></span>
      </div>
    </div>`;

  // row 4: personal care & beauty
  const cr4=document.getElementById('cr4');
  if(cr4) cr4.innerHTML=`
    <div class="cc tall" onclick="selCat('personal_care')">
      <h3>Personal Care</h3>
      <div class="cc-emojis-grid">
        <span><img src="images/shampoo.png" style="width:100%;height:100%;object-fit:contain;"></span>
        <span><img src="images/hairoil.png" style="width:100%;height:100%;object-fit:contain;"></span>
        <span><img src="images/dettol.png" style="width:100%;height:100%;object-fit:contain;"></span>
        <span><img src="images/colgate.png" style="width:100%;height:100%;object-fit:contain;"></span>
      </div>
    </div>
    <div class="cc" onclick="selCat('beauty')">
      <h3>Beauty</h3>
      <div class="cc-emojis">
        <span>💄</span><span>👁️</span><span>✨</span>
      </div>
    </div>`;
}

/* PRODUCTS PAGE */
function renderProds(){
  const list=P.filter(p=>(curCat==='all'||p.cat===curCat)&&
    (p.name.toLowerCase().includes(sq)||p.brand.toLowerCase().includes(sq)));
  document.getElementById('ptitle').textContent=sq?`"${sq}"`:(CATS.find(c=>c.id===curCat)?.l||'All');
  document.getElementById('fsi').innerHTML=CATS.map(c=>
    `<button class="fbtn${curCat===c.id?' active':''}" onclick="fcat('${c.id}')">${c.e} ${c.l}</button>`).join('');
  const g=document.getElementById('pgrid'),nr=document.getElementById('nores');
  if(!list.length){g.innerHTML='';nr.style.display='block';return;}
  nr.style.display='none';
  g.innerHTML=list.map(p=>{
    const qty=cart[p.id]||0;
    const disc=Math.round(((p.mrp-p.price)/p.mrp)*100);
    return`<div class="pc-card fia" data-pid="${p.id}">
      ${p.b?`<span class="pc-badge" style="background:${BC[p.b]}">${p.b}</span>`:''}
      ${disc>0?`<span class="pc-disc">${disc}%OFF</span>`:''}
      <div class="pc-emoji"><img src="${p.img}" style="width:60px;height:60px;object-fit:contain;" onerror="this.style.display='none'"/></div>
      <div class="pc-name">${sn(p.name)}</div>
      <div class="pc-weight">${p.brand} · ${p.w}</div>
      <div class="pc-bot">
        <div><div class="pc-price">₹${p.price}</div>${p.mrp>p.price?`<div style="font-size:10px;color:#ccc;text-decoration:line-through">₹${p.mrp}</div>`:''}</div>
        <div class="pc-bot-right">${qty===0
          ?`<button class="pc-add-btn" onclick="ac(${p.id})">+</button>`
          :`<div class="pc-qc"><button onclick="rc(${p.id})">−</button><span>${qty}</span><button onclick="ac(${p.id})">+</button></div>`}</div>
      </div>
    </div>`;
  }).join('');
}
function fcat(id){curCat=id;renderProds();}

/* CART */
/* Smooth in-place cart button update — zero glitch */
function updateCardBtn(id){
  const qty = cart[id] || 0;
  document.querySelectorAll('[data-pid="'+id+'"] .pc-bot-right').forEach(slot => {
    const newHtml = qty === 0
      ? '<button class="pc-add-btn" onclick="ac('+id+')">+</button>'
      : '<div class="pc-qc"><button onclick="rc('+id+')">−</button><span>'+qty+'</span><button onclick="ac('+id+')">+</button></div>';
    if(slot.innerHTML.trim() !== newHtml.trim()){
      slot.style.transition = 'transform 0.13s cubic-bezier(.34,1.56,.64,1), opacity 0.1s';
      slot.style.transform = 'scale(0.82)';
      slot.style.opacity = '0.7';
      slot.innerHTML = newHtml;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        slot.style.transform = 'scale(1)';
        slot.style.opacity = '1';
        setTimeout(()=>{ slot.style.transform=''; slot.style.transition=''; slot.style.opacity=''; }, 160);
      }));
    }
  });
}

function ac(id){
  cart[id]=(cart[id]||0)+1;
  const b=document.getElementById('cbadge');
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  upCart();
  updateCardBtn(id);
  if(curPage==='cart') renderCartPg();
  saveCartToDB();
}
function rc(id){
  if(!cart[id])return;
  cart[id]--;
  if(!cart[id])delete cart[id];
  upCart();
  updateCardBtn(id);
  if(curPage==='cart') renderCartPg();
  saveCartToDB();
}
function upCart(){
  const cnt=Object.values(cart).reduce((a,b)=>a+b,0);
  const tot=Object.entries(cart).reduce((s,[id,q])=>{const p=P.find(x=>x.id===+id);return s+(p?p.price*q:0);},0);
  const cb=document.getElementById('cbadge');
  cb.textContent=cnt; cb.style.display=cnt>0?'flex':'none';
  // header cart badge
  const hcb=document.getElementById('hcbadge');
  if(hcb){hcb.textContent=cnt;hcb.style.display=cnt>0?'flex':'none';}
  const pill=document.getElementById('cpill');
  pill.style.display=(cnt>0&&curPage!=='cart')?'block':'none';
  document.getElementById('pcnt').textContent=cnt;
  document.getElementById('ptxt').textContent=`${cnt} item${cnt>1?'s':''} added`;
  document.getElementById('ppr').textContent=`₹${tot} →`;
}
function renderCartPg(){
  const its=Object.entries(cart).map(([id,qty])=>({...P.find(p=>p.id===+id),qty}));
  const tot=its.reduce((s,i)=>s+i.price*i.qty,0);
  const mt=its.reduce((s,i)=>s+i.mrp*i.qty,0);
  const sv=mt-tot;
  const em=document.getElementById('c-empty'),ci=document.getElementById('citems');
  const bl=document.getElementById('bill'),ob=document.getElementById('ord-btn');
  if(!its.length){em.style.display='block';ci.innerHTML='';bl.style.display='none';ob.style.display='none';return;}
  em.style.display='none';bl.style.display='block';ob.style.display='block';
  ob.innerHTML=`🛵 Order Karo · ₹${tot}`;ob.onclick=placeOrder;
  ci.innerHTML=its.map(i=>`
    <div class="citem">
      <div class="cif">${i.img?`<img src="${i.img}" style="width:44px;height:44px;object-fit:contain;border-radius:8px;">`:`<span>${i.e}</span>`}</div>
      <div class="ci-info"><b>${i.name}</b><small>${i.brand} · ${i.w}</small></div>
      <div class="cart-qc">
        <button onclick="rc(${i.id})">−</button>
        <span>${i.qty}</span>
        <button onclick="ac(${i.id})">+</button>
      </div>
      <div class="ci-total">₹${i.price*i.qty}</div>
    </div>`).join('');
  document.getElementById('bm').textContent=`₹${mt}`;
  document.getElementById('bt').textContent=`₹${tot}`;
  const sr=document.getElementById('sr');
  if(sv>0){sr.style.display='flex';document.getElementById('bs').textContent=`-₹${sv}`;}
  else sr.style.display='none';
}
function placeOrder(){
  if (!currentUser) { openAuthModal(); showToast('⚠️ Pehle login karo!'); return; }
  // Save to order history before clearing cart
  const its=Object.entries(cart).map(([id,qty])=>({...P.find(p=>p.id===+id),qty}));
  const tot=its.reduce((s,i)=>s+i.price*i.qty,0);
  saveOrderToDB(its, tot).then(orderData => {
    if (orderData?.id) watchOrderStatus(orderData.id);
  });
  saveOrderToHistory(its, tot);
  cart={};upCart();renderCartPg();
  saveCartToDB();
  const mins=[3,4,5][Math.floor(Math.random()*3)];
  let totalSecs=mins*60;
  const overlay=document.getElementById('countdown-overlay');
  overlay.style.display='flex';
  overlay.querySelector('.cd-counting').style.display='flex';
  const riders=['🛵','🚴','🏍️'];
  overlay.querySelector('.cd-rider').textContent=riders[Math.floor(Math.random()*3)];
  overlay.querySelector('.cd-mins').textContent=mins;
  const circle=overlay.querySelector('.cd-ring-fill');
  const circ=2*Math.PI*54;
  circle.style.strokeDasharray=circ;
  circle.style.strokeDashoffset=circ;

  // Skip hint HIDE karo — tap se skip nahi hoga
  const skipHint=overlay.querySelector('.cd-skip-hint');
  if(skipHint) skipHint.style.display='none';

  function showDelivered(){
    clearInterval(ref);
    countdownInterval = null;
    overlay.style.display='none';
    // Sirf agar realtime update nahi aaya to delivered dikhao
    if (!document.getElementById('order-status-overlay') || document.getElementById('order-status-overlay').style.display==='none') {
      document.getElementById('delivered-overlay').style.display='block';
      launchConfetti();
    }
  }

  // Tap se skip NAHI hoga — remove onclick
  const countingCard=overlay.querySelector('.cd-counting');
  countingCard.onclick=null;
  countingCard.style.cursor='default';

  function tick(){
    const m=Math.floor(totalSecs/60),s=totalSecs%60;
    overlay.querySelector('.cd-time').textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    const elapsed=mins*60-totalSecs;
    circle.style.strokeDashoffset=circ-(circ*(elapsed/(mins*60)));
    const rider=overlay.querySelector('.cd-rider');
    rider.style.transform=totalSecs%2===0?'scale(1.2) translateY(-5px)':'scale(1) translateY(0)';
    if(totalSecs<=0){ showDelivered(); return; }
    totalSecs--;
  }
  tick(); countdownInterval = setInterval(tick,1000); const ref=countdownInterval;
}

function launchConfetti(){
  const canvas=document.getElementById('confetti-canvas2');
  const ctx=canvas.getContext('2d');
  canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;
  const cols=['#2a9d6a','#38ef9d','#ffd700','#ff6b9d','#4fc3f7','#ff7043','#fff'];
  const pieces=Array.from({length:130},()=>({x:Math.random()*canvas.width,y:-10-Math.random()*canvas.height,r:Math.random()*6+3,d:Math.random()*3+2,color:cols[Math.floor(Math.random()*cols.length)],tilt:0,ta:0,ts:Math.random()*.12+.04}));
  let f,t=0;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    pieces.forEach(p=>{p.ta+=p.ts;p.y+=p.d;p.tilt=Math.sin(p.ta)*12;if(p.y>canvas.height)p.y=-10;ctx.beginPath();ctx.ellipse(p.x+p.tilt,p.y,p.r,p.r*.4,p.ta,0,2*Math.PI);ctx.fillStyle=p.color;ctx.fill();});
    t++;f=requestAnimationFrame(draw);if(t>240)cancelAnimationFrame(f);
  }
  draw();
}

function closeDelivered(){
  document.getElementById('delivered-overlay').style.display='none';
  showPage('home');
}

/* ===== ORDER STATUS TRACKING (Full Live Updates) ===== */
let activeOrderDbId = null;
let orderStatusSub = null;
let countdownInterval = null; // global ref to stop countdown

function watchOrderStatus(orderId) {
  activeOrderDbId = orderId;
  if (orderStatusSub) { sb.removeChannel(orderStatusSub); orderStatusSub = null; }

  orderStatusSub = sb.channel('order-status-' + orderId)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'orders',
      filter: 'id=eq.' + orderId
    }, payload => {
      const newStatus = payload.new?.status;
      console.log('Order status update:', newStatus);
      handleOrderStatusUpdate(newStatus);
    })
    .subscribe();
}

function handleOrderStatusUpdate(status) {
  // Update countdown message while it's still showing
  const cdMsg = document.getElementById('cd-status-msg');
  const cdTitle = document.querySelector('#countdown-overlay [style*="ORDER PLACED"]');
  const cdSub = document.querySelector('#countdown-overlay [style*="Your rider"]');

  if (status === 'rejected') {
    showOrderStatusCard('cancelled');
  } else if (status === 'preparing') {
    if (cdMsg) cdMsg.textContent = '👨‍🍳 Seller ne accept kiya! Prepare ho raha hai...';
    if (cdMsg) cdMsg.style.color = '#ff9800';
    if (cdSub) cdSub.textContent = 'GrocerX Shop order bana raha hai!';
    showToast('✅ Seller ne order accept kar liya!');
  } else if (status === 'ready') {
    if (cdMsg) cdMsg.textContent = '📦 Order ready! Delivery partner aa raha hai...';
    if (cdMsg) cdMsg.style.color = '#2a9d6a';
    if (cdSub) cdSub.textContent = 'Delivery partner pick karega abhi!';
    showToast('📦 Order ready ho gaya!');
    showOrderStatusCard('ready');
  } else if (status === 'done') {
    showOrderStatusCard('done');
  }
}

// status: 'preparing' | 'ready' | 'done' | 'cancelled'
function showOrderStatusCard(status) {
  // Stop countdown interval
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  // Hide countdown
  const cdOverlay = document.getElementById('countdown-overlay');
  if (cdOverlay) cdOverlay.style.display = 'none';

  const statusOverlay = document.getElementById('order-status-overlay');
  const iconEl   = document.getElementById('os-icon');
  const titleEl  = document.getElementById('os-title');
  const subEl    = document.getElementById('os-sub');
  const btnEl    = document.getElementById('os-btn');
  const stepEl   = document.getElementById('os-steps');

  const configs = {
    preparing: {
      icon: '👨‍🍳',
      title: 'Order Accept Ho Gaya!',
      sub: 'GrocerX Shop aapka order prepare kar raha hai...',
      color: '#ff9800',
      steps: ['✅ Order Placed', '🟠 Preparing', '⬜ Ready', '⬜ Delivered'],
      btnTxt: null
    },
    ready: {
      icon: '📦',
      title: 'Order Ready Hai!',
      sub: 'GrocerX Shop ne order ready kar diya! Delivery partner pick karega abhi.',
      color: '#2a9d6a',
      steps: ['✅ Order Placed', '✅ Preparing', '🟢 Ready for Pickup', '⬜ Delivered'],
      btnTxt: null
    },
    done: {
      icon: '🎉',
      title: 'Delivered!',
      sub: 'Aapka order deliver ho gaya! Enjoy karo 😊',
      color: '#2a9d6a',
      steps: ['✅ Order Placed', '✅ Preparing', '✅ Ready', '✅ Delivered'],
      btnTxt: '🏠 Back to Home'
    },
    cancelled: {
      icon: '😞',
      title: 'Order Cancel Ho Gaya',
      sub: 'Seller ne order cancel kar diya. Koi baat nahi, dobara try karo!',
      color: '#e53935',
      steps: ['✅ Order Placed', '❌ Cancelled', '', ''],
      btnTxt: '🛍️ Continue Shopping'
    }
  };

  const cfg = configs[status];
  if (!cfg) return;

  iconEl.textContent  = cfg.icon;
  titleEl.textContent = cfg.title;
  titleEl.style.color = cfg.color;
  subEl.textContent   = cfg.sub;
  stepEl.innerHTML = cfg.steps.filter(s => s).map(s =>
    `<div style="font-size:13px;font-weight:700;color:#444;padding:6px 0;border-bottom:1px solid #f0f0f0;">${s}</div>`
  ).join('');

  if (cfg.btnTxt) {
    btnEl.textContent = cfg.btnTxt;
    btnEl.style.display = 'block';
    btnEl.onclick = () => {
      statusOverlay.style.display = 'none';
      if (orderStatusSub) { sb.removeChannel(orderStatusSub); orderStatusSub = null; }
      showPage('home');
    };
  } else {
    btnEl.style.display = 'none';
  }

  statusOverlay.style.display = 'flex';

  // If done, also show confetti
  if (status === 'done') {
    setTimeout(() => launchConfetti(), 300);
  }
}

function closeOrderStatusOverlay() {
  document.getElementById('order-status-overlay').style.display = 'none';
  if (orderStatusSub) { sb.removeChannel(orderStatusSub); orderStatusSub = null; }
  showPage('home');
}

// Legacy function name support
function showOrderCancelled() { showOrderStatusCard('cancelled'); }
function closeCancelledOverlay() { closeOrderStatusOverlay(); }



/* CATEGORIES GRID */
function buildCatsGrid(){
  document.getElementById('cats-grid').innerHTML=CATS.filter(c=>c.id!=='all').map(c=>`
    <button class="cc2" onclick="selCat('${c.id}')">
      ${c.img?`<img src="${c.img}" style="width:52px;height:52px;object-fit:contain;border-radius:10px;" onerror="this.style.display='none'">`:`<div class="cc2-ico">${c.e}</div>`}
      <span class="clb">${c.l}</span>
      <span class="cct">${P.filter(p=>p.cat===c.id).length} items</span>
    </button>`).join('');
}
function initLocation(){
  const addrEl=document.querySelector('.h-addr');
  addrEl.innerHTML='<b>Addr. -</b> Detecting... 📍';
  addrEl.style.cursor='pointer';
  addrEl.onclick=openLocationModal;
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`)
      .then(r=>r.json()).then(d=>{
        const addr=d.address;
        const short=(addr.road||addr.suburb||addr.neighbourhood||'Your Location')+', '+(addr.city||addr.town||addr.village||'');
        addrEl.innerHTML=`<b>Addr. -</b> ${short} ▼`;
      });
    },()=>{addrEl.innerHTML='<b>Addr. -</b> username.xyz ▼';});
  }
}

function openLocationModal(){
  document.getElementById('loc-modal').style.display='flex';
  initMap();
}

function closeLocationModal(){
  document.getElementById('loc-modal').style.display='none';
}

let locMap=null;
function initMap(){
  if(locMap){locMap.remove();locMap=null;}
  const modal=document.getElementById('loc-modal');
  const mapDiv=document.getElementById('loc-map');
  mapDiv.style.height='220px';
  
  setTimeout(()=>{
    locMap=L.map('loc-map').setView([28.6139,77.2090],13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(locMap);
    
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(pos=>{
        const latlng=[pos.coords.latitude,pos.coords.longitude];
        locMap.setView(latlng,15);
        L.marker(latlng).addTo(locMap).bindPopup('You are here!').openPopup();
        reverseGeocode(latlng[0],latlng[1]);
      });
    }
    
    locMap.on('click',function(e){
      locMap.eachLayer(l=>{if(l instanceof L.Marker)locMap.removeLayer(l);});
      L.marker(e.latlng).addTo(locMap);
      reverseGeocode(e.latlng.lat,e.latlng.lng);
    });
  },100);
}

function reverseGeocode(lat,lon){
  fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`)
  .then(r=>r.json()).then(d=>{
    const addr=d.address;
    const full=(addr.road||addr.suburb||'')+', '+(addr.neighbourhood||addr.suburb||'')+', '+(addr.city||addr.town||addr.village||'');
    document.getElementById('loc-input').value=full;
  });
}

function searchLocation(){
  const q=document.getElementById('loc-input').value;
  if(!q)return;
  fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`)
  .then(r=>r.json()).then(d=>{
    if(d.length){
      const lat=+d[0].lat,lon=+d[0].lon;
      locMap.setView([lat,lon],15);
      locMap.eachLayer(l=>{if(l instanceof L.Marker)locMap.removeLayer(l);});
      L.marker([lat,lon]).addTo(locMap);
      reverseGeocode(lat,lon);
    }
  });
}

function confirmLocation(){
  const addr=document.getElementById('loc-input').value;
  if(addr){
    document.querySelector('.h-addr').innerHTML=`<b>Addr. -</b> ${addr.substring(0,35)}... ▼`;
  }
  closeLocationModal();
}
/* SEARCH */
/* ===== VOICE SEARCH ===== */
let voiceRecognition = null;

function startVoiceSearch() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    showToast('⚠️ Aapka browser voice search support nahi karta');
    return;
  }

  const micBtn = document.getElementById('voice-mic-btn');

  if (voiceRecognition) {
    voiceRecognition.stop();
    voiceRecognition = null;
    if (micBtn) { micBtn.style.color = '#aaa'; micBtn.style.animation = ''; }
    return;
  }

  voiceRecognition = new SpeechRec();
  voiceRecognition.lang = 'en-IN';
  voiceRecognition.interimResults = true;
  voiceRecognition.maxAlternatives = 1;

  voiceRecognition.onstart = () => {
    if (micBtn) {
      micBtn.style.color = '#e53935';
      micBtn.style.animation = 'micPulse 0.8s ease-in-out infinite';
    }
    showToast('🎤 Bol do — search kar raha hoon...');
  };

  voiceRecognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map(r => r[0].transcript)
      .join('');
    const searchInput = document.getElementById('si');
    if (searchInput) {
      searchInput.value = transcript;
      handleSearch(transcript);
    }
  };

  voiceRecognition.onend = () => {
    voiceRecognition = null;
    if (micBtn) { micBtn.style.color = '#aaa'; micBtn.style.animation = ''; }
  };

  voiceRecognition.onerror = (e) => {
    voiceRecognition = null;
    if (micBtn) { micBtn.style.color = '#aaa'; micBtn.style.animation = ''; }
    if (e.error === 'no-speech') showToast('🎤 Kuch suna nahi — dobara try karo');
    else showToast('❌ Voice error: ' + e.error);
  };

  voiceRecognition.start();
}

function handleSearch(v){sq=v.toLowerCase();if(v.length>0)showPage('products');}

/* NAV */
function showPage(p){
  curPage=p;
  document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  document.querySelectorAll('.nb').forEach(e=>e.classList.remove('active'));
  const nb=document.getElementById('nb-'+p);
  if(nb)nb.classList.add('active');
  upCart();
  if(p==='products')renderProds();
  if(p==='cart'){document.getElementById('ord-ok').style.display='none';renderCartPg();}
  if(p==='home'){buildBestsellers();}
  document.getElementById('main').scrollTop=0;
}
function goBack(){sq='';document.getElementById('si').value='';curCat='all';showPage('home');}

/* ===== ORDERS HISTORY ===== */
let orderHistory = [];

function saveOrderToHistory(items, total) {
  const id = 'ORD' + Date.now().toString().slice(-6);
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
  const timeStr = now.toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'});
  orderHistory.unshift({
    id, date: dateStr + ' · ' + timeStr,
    items: items.slice(0, 3).map(i => i.name + ' ×' + i.qty).join(', ') + (items.length > 3 ? ` +${items.length-3} more` : ''),
    total, count: items.length
  });
  // Update orders small text
  const sm = document.getElementById('orders-small');
  if(sm) sm.textContent = orderHistory.length + ' order' + (orderHistory.length > 1 ? 's' : '') + ' placed';
}

function openOrdersSheet() {
  const list = document.getElementById('orders-list');
  if (!orderHistory.length) {
    list.innerHTML = `<div class="no-orders"><div class="no-ord-ico">📦</div><p>Abhi tak koi order nahi!<br>Kuch order karo 🛒</p></div>`;
  } else {
    list.innerHTML = orderHistory.map(o => `
      <div class="order-card">
        <div class="order-top">
          <span class="order-id">#${o.id}</span>
          <span class="order-date">${o.date}</span>
        </div>
        <div class="order-items">${o.items}</div>
        <div class="order-footer">
          <span class="order-total">₹${o.total}</span>
          <span class="order-status">✓ Delivered</span>
        </div>
      </div>`).join('');
  }
  openBottomSheet('orders');
}

/* ===== ADDRESS ===== */
let savedAddress = { name:'username.xyz', phone:'', house:'', area:' ', city:'', pin:'' };

function openAddressSheet() {
  document.getElementById('addr-name').value  = savedAddress.name;
  document.getElementById('addr-phone').value = savedAddress.phone;
  document.getElementById('addr-house').value = savedAddress.house;
  document.getElementById('addr-area').value  = savedAddress.area;
  document.getElementById('addr-city').value  = savedAddress.city;
  document.getElementById('addr-pin').value   = savedAddress.pin;
  openBottomSheet('address');
}

function saveAddress() {
  savedAddress = {
    name:  document.getElementById('addr-name').value.trim(),
    phone: document.getElementById('addr-phone').value.trim(),
    house: document.getElementById('addr-house').value.trim(),
    area:  document.getElementById('addr-area').value.trim(),
    city:  document.getElementById('addr-city').value.trim(),
    pin:   document.getElementById('addr-pin').value.trim()
  };
  const short = (savedAddress.area || savedAddress.city || 'Your Location') + (savedAddress.city ? ', ' + savedAddress.city : '');
  // Update header address
  const hAddr = document.querySelector('.h-addr');
  if(hAddr) hAddr.innerHTML = `<b>Addr. -</b> ${short.substring(0,28)} ▼`;
  // Update profile name and phone live
  const pn2 = document.querySelector('.pn2');
  const pph = document.querySelector('.pph');
  if(pn2) pn2.textContent = savedAddress.name || 'username.xyz';
  if(pph) pph.textContent = savedAddress.phone || ' ';
  // Update profile small text
  const sm = document.getElementById('prof-addr-small');
  if(sm) sm.textContent = short;
  saveAddressToDB(savedAddress);
  closeAllSheets();
  showToast('✅ Address saved!');
}

/* ===== GENERIC SHEET OPENER ===== */
function openSheet(type) { openBottomSheet(type); }

function openBottomSheet(type) {
  document.getElementById('sheet-backdrop').style.display = 'block';
  document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
  const sh = document.getElementById('sheet-' + type);
  if(sh) { void sh.offsetWidth; sh.classList.add('open'); }
}

function closeAllSheets() {
  document.getElementById('sheet-backdrop').style.display = 'none';
  document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
}

/* ===== PAYMENT SELECT ===== */
document.querySelectorAll('.pay-option').forEach(opt => {
  opt.addEventListener('click', function(){
    document.querySelectorAll('.pay-option').forEach(o => { o.classList.remove('active-pay'); o.querySelector('.pay-check').textContent = ''; });
    this.classList.add('active-pay');
    this.querySelector('.pay-check').textContent = '✓';
  });
});

/* ===== COUPON COPY ===== */
function copyCoupon(code) {
  if(navigator.clipboard) navigator.clipboard.writeText(code).catch(()=>{});
  showToast('🎉 Code copied: ' + code);
}

/* ===== TOGGLE ===== */
function toggleSetting(el) {
  el.classList.toggle('active-toggle');
}

/* ===== TOAST ===== */
let toastTimer;
function showToast(msg) {
  let t = document.getElementById('gx-toast');
  if(!t){ t = document.createElement('div'); t.id='gx-toast'; t.className='gx-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ===== PRINT SERVICE ===== */
let printState = { color:'bw', size:'a4', qty:1, hasFile:false };
const PRINT_PRICES = { bw:2, color:10 };
const SIZE_EXTRA   = { a4:0, a3:5, a5:0 };

function handlePrintFile(input) {
  const file = input.files[0];
  if (!file) return;
  printState.hasFile = true;
  document.getElementById('print-upload-zone').style.display = 'none';
  document.getElementById('print-preview-wrap').style.display = 'block';

  if (file.type === 'application/pdf') {
    document.getElementById('print-img-preview').style.display = 'none';
    document.getElementById('print-pdf-preview').style.display = 'block';
    document.getElementById('print-pdf-name').textContent = file.name;
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('print-img-preview').src = e.target.result;
      document.getElementById('print-img-preview').style.display = 'block';
      document.getElementById('print-pdf-preview').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
  updatePrintPrice();
}

function resetPrintFile() {
  printState.hasFile = false;
  document.getElementById('print-file-input').value = '';
  document.getElementById('print-upload-zone').style.display = 'flex';
  document.getElementById('print-preview-wrap').style.display = 'none';
  document.getElementById('print-img-preview').src = '';
}

function selectPrintOpt(type, val, el) {
  if (type === 'color') {
    document.getElementById('popt-bw').classList.remove('active-popt');
    document.getElementById('popt-color').classList.remove('active-popt');
    printState.color = val;
  } else {
    ['a4','a3','a5'].forEach(s => document.getElementById('popt-'+s).classList.remove('active-popt'));
    printState.size = val;
  }
  el.classList.add('active-popt');
  updatePrintPrice();
}

function changePrintQty(d) {
  printState.qty = Math.max(1, Math.min(50, printState.qty + d));
  document.getElementById('print-qty-val').textContent = printState.qty;
  updatePrintPrice();
}

function updatePrintPrice() {
  const base  = PRINT_PRICES[printState.color];
  const extra = SIZE_EXTRA[printState.size];
  const spiral = document.getElementById('toggle-binding') && document.getElementById('toggle-binding').classList.contains('active-toggle') ? 30 : 0;
  const total = (base + extra) * printState.qty + spiral;
  document.getElementById('pp-color').textContent   = printState.color === 'bw' ? 'B&W' : 'Color';
  document.getElementById('pp-size').textContent    = printState.size.toUpperCase();
  document.getElementById('pp-copies').textContent  = printState.qty;
  // Spiral row show/hide
  const spiralRow = document.getElementById('pp-spiral-row');
  if(spiralRow) spiralRow.style.display = spiral > 0 ? 'flex' : 'none';
  document.getElementById('pp-total').textContent   = '₹' + total;
}

function placePrintOrder() {
  if (!printState.hasFile) { showToast('⚠️ Pehle file upload karo!'); return; }
  // Save print order to history
  const base  = PRINT_PRICES[printState.color];
  const extra = SIZE_EXTRA[printState.size];
  const spiral = document.getElementById('toggle-binding') && document.getElementById('toggle-binding').classList.contains('active-toggle') ? 30 : 0;
  const total = (base + extra) * printState.qty + spiral;
  const colorLabel = printState.color === 'bw' ? 'B&W' : 'Color';
  const spiralLabel = spiral > 0 ? ' + Spiral' : '';
  const desc = `🖨️ Print: ${colorLabel}, ${printState.size.toUpperCase()}, ${printState.qty} cop${printState.qty>1?'ies':'y'}${spiralLabel}`;
  saveOrderToHistory([{ name: desc, brand: 'Print Service', w: '', price: total, mrp: total, qty: 1, id: 9999, e: '🖨️' }], total);
  showToast('🖨️ Print order placed! Ready in 10 min ✅');
  setTimeout(() => { resetPrintFile(); printState = {color:'bw',size:'a4',qty:1,hasFile:false}; }, 1800);
}


/* ===== LOAD PRODUCTS FROM SUPABASE (Seller se sync) ===== */
async function loadProductsFromDB() {
  const { data, error } = await sb.from('products')
    .select('*')
    .eq('stock', true)
    .order('id', { ascending: true });

  if (error || !data || !data.length) {
    console.log('Products DB se nahi aaye, local use kar rahe hain');
    return;
  }

  // Update P array with DB values (price, mrp, stock)
  data.forEach(dbP => {
    const local = P.find(p => p.id === dbP.id);
    if (local) {
      local.price = dbP.price || local.price;
      local.mrp   = dbP.mrp   || local.mrp;
      local.stock = dbP.stock !== false;
    } else if (dbP.name && dbP.price > 0) {
      // New product added by seller — add to P array
      P.push({
        id:    dbP.id,
        name:  dbP.name,
        brand: dbP.brand || '',
        price: dbP.price,
        mrp:   dbP.mrp || dbP.price,
        w:     dbP.weight || '',
        cat:   dbP.cat || 'packed_item',
        e:     '🛒',
        b:     null,
        img:   dbP.img || '',
        stock: dbP.stock !== false
      });
    }
  });

  // Rebuild UI with updated products
  buildCards();
  buildBestsellers();
  buildCatsGrid();
  console.log('Products synced from DB:', data.length);
}

/* ===== INIT */
buildStrip(); buildBanner(); buildCards(); buildBestsellers(); buildCatsGrid(); upCart(); initLocation();
document.getElementById('nb-grocerx').classList.add('active');
initAuth();
// Products Supabase se sync karo
loadProductsFromDB();
