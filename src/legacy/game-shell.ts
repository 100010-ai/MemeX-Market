export const GAME_SHELL = `

<div id="preloader">
  <div class="pl-grid"></div>
  <div class="pl-scan"></div>
  <div class="pl-logo">AUTO<span>SYNDICATE</span></div>
  <div class="pl-stage" id="pl-stage">КАРБОНОВЫЙ РАЙОН</div>
  <div class="pl-bar-bg"><div class="pl-bar-fill" id="pl-bar"></div></div>
  <div class="pl-row"><span class="pl-sub" id="pl-sub">Подготовка улиц</span><b id="pl-percent">0%</b></div>
  <div class="pl-tip" id="pl-tip">Идеальный SHIFT сохраняет больше оборотов после переключения.</div>
</div>


<header>
  <div class="header-left">
    <div class="avatar-mini" id="header-avatar" onclick="switchTab('profile')">Г</div>
    <div class="brand-lockup" onclick="tapLogo()"><div class="logo">Auto<span>Syndicate</span></div><div class="brand-sub">КАРБОНОВЫЙ РАЙОН</div></div>
  </div>
  <div class="header-stats">
    <div class="rep-badge">LVL <span id="lvl-display">1</span></div>
    <div class="balance synd-balance"><span class="currency-chip">₳</span><span id="coins-display">1 500</span><span class="currency-name">SYND</span></div>
  </div>
</header>

<main id="main-scroll">

  <!-- ГАРАЖ -->
  <div id="screen-garage" class="screen active">
    <div class="section-title"><span>Ваш гараж</span><span id="garage-count" style="color:#fff;font-size:12px;"></span></div>
    <div class="quick-service" id="garage-quick-service"></div>
    <div class="carbon-toolbar" id="garage-toolbar"></div>
    <div class="list-container" id="garage-list"></div>
  </div>

  <!-- САЛОН -->
  <div id="screen-shop" class="screen">
    <div class="section-title"><span>Дилерский центр</span></div>
    <div class="carbon-toolbar" id="shop-toolbar"></div>
    <div class="list-container" id="shop-list"></div>
  </div>

  <!-- КАРТОЧКА МАШИНЫ -->
  <div id="screen-cardetail" class="screen">
    <div class="back-link" onclick="goBackFromDetail()">← Назад</div>
    <div id="detail-content" style="width:100%;max-width:520px;display:flex;flex-direction:column;align-items:center;"></div>
  </div>

  <!-- ТЮНИНГ -->
  <div id="screen-tune" class="screen">
    <div class="back-link" onclick="openDetail(state.tuneTargetId)">← Назад к карточке</div>
    <div class="section-title"><span id="tune-car-title">Тюнинг</span></div>
    <div class="list-container" id="tune-list" style="max-width:520px;"></div>
  </div>

  <!-- ДУЭЛЬ: выбор соперника -->
  <div id="screen-duel-select" class="screen duel-screen-v11">
    <div class="duel-v11-heading">
      <div><span>КАРБОНОВАЯ ЛИГА</span><h2>Дуэльная сетка</h2><p>Подбери соперника под свою сборку и забери его позицию в уличной иерархии.</p></div>
      <div class="duel-v11-live"><i></i><b>В СЕТИ</b><span id="duel-online-label">поиск соперников</span></div>
    </div>
    <div class="subtabs duel-v11-tabs">
      <div class="subtab-btn active" id="dsub-normal" onclick="switchDuelSub('normal')">Сетка</div>
      <div class="subtab-btn" id="dsub-tour" onclick="switchDuelSub('tour')">Турниры</div>
      <div class="subtab-btn" id="dsub-pvp" onclick="switchDuelSub('pvp')">Игроки</div>
    </div>
    <div class="duel-v11-toolbar" id="duel-filter-wrap">
      <button class="active" data-duel-filter="all" onclick="setDuelFilter('all')">Все</button>
      <button data-duel-filter="equal" onclick="setDuelFilter('equal')">Равные</button>
      <button data-duel-filter="risk" onclick="setDuelFilter('risk')">Риск</button>
      <button data-duel-filter="boss" onclick="setDuelFilter('boss')">Боссы</button>
    </div>
    <div class="duel-v11-summary" id="duel-match-summary"></div>
    <div class="list-container duel-v11-list" id="opponent-list"></div>
    <div class="list-container" id="pvp-wrap" style="display:none;">
      <div class="sell-picker">
        <div class="gauge-label" style="text-align:left;margin-bottom:6px;">Создать вызов</div>
        <div class="pre-race-line"><span>Твоя мощность (текущая тачка)</span><b id="pvp-my-power">0 л.с.</b></div>
        <div class="btn-row" style="width:100%;gap:8px;margin-top:8px;">
          <input class="chat-input" id="pvp-stake-input" type="number" placeholder="Ставка, " style="border-radius:10px;">
          <button class="sell-btn market" style="white-space:nowrap;" onclick="postPvpChallenge()">Бросить вызов</button>
        </div>
      </div>
      <div class="section-title" style="margin-top:4px;"><span>Открытые вызовы</span></div>
      <div class="list-container" id="pvp-list"></div>
    </div>
  </div>

  <!-- ГОНКА -->
  <div id="screen-race" class="screen">
    <div id="race-content" style="width:100%;max-width:480px;"></div>
  </div>

  <!-- БАНК -->
  <div id="screen-bank" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Банк синдиката</span></div>
    <div class="sell-picker">
      <div class="pre-race-line"><span>Баланс</span><b id="bank-balance" style="color:var(--gold);">0</b></div>
      <div class="pre-race-line"><span>Игровой ID для переводов</span></div>
      <div class="listing-meta" id="bank-my-id" style="user-select:all;word-break:break-all;">—</div>
    </div>
    <div class="sell-picker">
      <div class="gauge-label" style="text-align:left;margin-bottom:6px;">Перевести другому игроку</div>
      <input class="chat-input" id="bank-to-id" placeholder="ID получателя" style="border-radius:10px;margin-bottom:8px;width:100%;">
      <input class="chat-input" id="bank-amount" type="number" placeholder="Сумма, " style="border-radius:10px;margin-bottom:8px;width:100%;">
      <button class="big-btn" onclick="sendBankTransfer()">Отправить</button>
      <div class="chat-status" id="bank-send-status" style="margin-top:8px;"></div>
      <div class="empty-note transfer-limit-note">До 800 SYND за перевод · дневной лимит 2 000 SYND</div>
    </div>
    <div class="section-title"><span>История</span></div>
    <div class="list-container" id="bank-log"></div>
  </div>

  <!-- РАБОТА -->
  <div id="screen-jobs" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Подработка</span></div>
    <div class="list-container" id="jobs-list"></div>
  </div>

  <!-- КАЗИНО ХАБ -->
  <div id="screen-casino" class="screen casino-screen-premium">
    <div class="casino-hero-premium"><div><span>ЗАКРЫТЫЙ КЛУБ</span><h2>Казино синдиката</h2><p>Четыре игры. Один баланс. Ставки фиксируются до результата.</p></div><div class="casino-live-dot"><i></i>ОТКРЫТО</div></div>
    <div class="casino-session-stats" id="casino-session-stats"></div>
    <div class="list-container" id="casino-hub-list"></div>
  </div>

  <!-- BLACKJACK -->
  <div id="screen-blackjack" class="screen casino-game-screen">
    <div class="back-link" onclick="switchTab('casino')">← Казино</div>
    <div class="section-title"><span>Блэкджек 21</span></div>
    <div class="game-table">
      <div class="bj-hand-label"><span>Дилер</span><span id="bj-dealer-score"></span></div>
      <div class="bj-cards" id="bj-dealer-cards"></div>
      <div class="bj-hand-label"><span>Вы</span><span id="bj-player-score"></span></div>
      <div class="bj-cards" id="bj-player-cards"></div>
    </div>
    <div id="bj-message" style="width:100%;max-width:480px;text-align:center;font-weight:900;font-size:14px;min-height:20px;margin-bottom:8px;"></div>
    <div class="bet-panel" id="bj-bet-panel">
      <div class="bet-row">
        <button class="chip-btn" onclick="bjAdjustBet(-50)">-50</button>
        <input class="bet-input" id="bj-bet-input" type="number" value="100">
        <button class="chip-btn" onclick="bjAdjustBet(50)">+50</button>
        <button class="chip-btn" onclick="bjMaxBet()">МАКС</button>
      </div>
      <button class="btn btn-select" style="margin-top:10px;" onclick="bjDeal()">РАЗДАТЬ</button>
    </div>
    <div class="btn-row" id="bj-action-panel" style="display:none;width:100%;max-width:480px;gap:7px;"></div>
  </div>

  <!-- ROULETTE -->
  <div id="screen-roulette" class="screen casino-game-screen">
    <div class="back-link" onclick="switchTab('casino')">← Казино</div>
    <div class="section-title"><span>Рулетка</span></div>
    <div class="rlt-result-num" id="rlt-result" style="background:#1a1a24;">?</div>
    <div class="roulette-grid" id="rlt-grid"></div>
    <div class="rlt-outside" id="rlt-outside"></div>
    <div class="bet-panel">
      <div class="bet-row">
        <button class="chip-btn" onclick="rltAdjustBet(-50)">-50</button>
        <input class="bet-input" id="rlt-bet-input" type="number" value="100">
        <button class="chip-btn" onclick="rltAdjustBet(50)">+50</button>
        <button class="chip-btn" onclick="rltMaxBet()">МАКС</button>
      </div>
      <button class="btn btn-select" style="margin-top:10px;" onclick="rltSpin()">КРУТИТЬ</button>
    </div>
  </div>

  <!-- SLOTS -->
  <div id="screen-slots" class="screen casino-game-screen">
    <div class="back-link" onclick="switchTab('casino')">← Казино</div>
    <div class="section-title"><span>Слоты «777»</span></div>
    <div class="game-table">
      <div class="slots-reels">
        <div class="reel" id="reel0"></div>
        <div class="reel" id="reel1"></div>
        <div class="reel" id="reel2"></div>
      </div>
      <div id="slots-message" style="text-align:center;font-weight:900;font-size:13px;min-height:18px;"></div>
    </div>
    <div class="bet-panel">
      <div class="bet-row">
        <button class="chip-btn" onclick="slotsAdjustBet(-25)">-25</button>
        <input class="bet-input" id="slots-bet-input" type="number" value="50">
        <button class="chip-btn" onclick="slotsAdjustBet(25)">+25</button>
        <button class="chip-btn" onclick="slotsMaxBet()">МАКС</button>
      </div>
      <button class="btn btn-select" style="margin-top:10px;" onclick="slotsSpin()">КРУТИТЬ</button>
    </div>
  </div>

  <!-- DICE -->
  <div id="screen-dice" class="screen casino-game-screen">
    <div class="back-link" onclick="switchTab('casino')">← Казино</div>
    <div class="section-title"><span>Кости</span></div>
    <div class="game-table">
      <div class="dice-result-num" id="dice-result" style="color:var(--text-muted);">0</div>
      <div class="dice-readout"><span>Шанс: <b id="dice-chance">49%</b></span><span>Выплата: <b id="dice-mult">x2.00</b></span></div>
      <input class="dice-slider" type="range" id="dice-slider" min="2" max="98" value="50" oninput="diceUpdate()">
      <div class="dice-readout"><span>Бросить меньше</span><span id="dice-target">50</span></div>
    </div>
    <div class="bet-panel">
      <div class="bet-row">
        <button class="chip-btn" onclick="diceAdjustBet(-50)">-50</button>
        <input class="bet-input" id="dice-bet-input" type="number" value="100">
        <button class="chip-btn" onclick="diceAdjustBet(50)">+50</button>
        <button class="chip-btn" onclick="diceMaxBet()">МАКС</button>
      </div>
      <button class="btn btn-select" style="margin-top:10px;" onclick="diceRoll()">БРОСИТЬ</button>
    </div>
  </div>

  <!-- ПРОФИЛЬ -->
  <div id="screen-profile" class="screen">
    <div class="profile-hero">
      <div class="profile-avatar-block"><div class="avatar-circle" id="avatar-letter">Г</div><span>ГОНЩИК</span></div>
      <div class="profile-identity">
        <div class="profile-kicker">КАРБОНОВЫЙ РАЙОН</div>
        <div class="profile-name" id="profile-name">Гонщик</div>
        <div class="profile-rep">Уличный рейтинг · LVL <span id="profile-lvl">1</span></div>
      </div>
      <div class="profile-signature">AS</div>
    </div>
    <div class="xp-wrap">
      <div class="xp-top"><span>Опыт</span><span id="xp-text">0/100</span></div>
      <div class="xp-bar-bg"><div class="xp-bar-fill" id="xp-fill" style="width:0%"></div></div>
    </div>
    <div class="heat-strip" id="profile-heat"></div>
    <div id="recent-race-summary" style="width:100%;max-width:520px;margin-bottom:10px;"></div>
    <div class="stats-grid">
      <div class="stat-tile"><div class="val" id="p-balance">0</div><div class="lbl">Баланс </div></div>
      <div class="stat-tile"><div class="val" id="p-cars">0</div><div class="lbl">Машин в гараже</div></div>
      <div class="stat-tile"><div class="val" id="p-races">0</div><div class="lbl">Заездов всего</div></div>
      <div class="stat-tile"><div class="val" id="p-winrate">0%</div><div class="lbl">Процент побед</div></div>
      <div class="stat-tile"><div class="val" id="p-wins">0</div><div class="lbl">Побед</div></div>
      <div class="stat-tile"><div class="val" id="p-losses">0</div><div class="lbl">Поражений</div></div>
      <div class="stat-tile"><div class="val" id="p-earned">0</div><div class="lbl">Всего заработано</div></div>
      <div class="stat-tile"><div class="val" id="p-fines">0</div><div class="lbl">Штрафов от ДПС</div></div>
    </div>
    <div class="hub-grid">
      <div class="hub-card" onclick="switchTab('districts')"><div class="ic"></div><div class="lbl">Районы</div><div class="sub" id="district-progress-sub">Карьера</div></div>
      <div class="hub-card" onclick="switchTab('contracts')"><div class="ic"></div><div class="lbl">Контракты</div><div class="sub" id="contract-progress-sub">Ежедневные</div></div>
      <div class="hub-card" onclick="switchTab('jobs')"><div class="ic"></div><div class="lbl">Подработка</div><div class="sub">2-й доход</div></div>
      <div class="hub-card" onclick="switchTab('achievements')"><div class="ic"></div><div class="lbl">Достижения</div><div class="sub" id="ach-progress-sub">0/0</div></div>
      <div class="hub-card" onclick="switchTab('cases')"><div class="ic"></div><div class="lbl">Кейсы</div><div class="sub">Нитро: <span id="hub-nitro-count">0</span></div></div>
      <div class="hub-card" onclick="switchTab('leaderboard')"><div class="ic"></div><div class="lbl">Рейтинг</div><div class="sub">Синдикат</div></div>
      <div class="hub-card" onclick="openDailyModal(true)"><div class="ic"></div><div class="lbl">Награда дня</div><div class="sub" id="daily-hub-sub">Забрать</div></div>
      <div class="hub-card" onclick="switchTab('market')"><div class="ic"></div><div class="lbl">Рынок</div><div class="sub">Игроки продают</div></div>
      <div class="hub-card" onclick="switchTab('chat')"><div class="ic"></div><div class="lbl">Чат</div><div class="sub">Синдикат онлайн</div></div>
      <div class="hub-card" onclick="switchTab('bank')"><div class="ic"></div><div class="lbl">Банк</div><div class="sub">Переводы</div></div>
      <div class="hub-card" onclick="switchTab('settings')"><div class="ic"></div><div class="lbl">Настройки</div><div class="sub">Игра и управление</div></div>
    </div>
    <div class="sell-picker" id="license-status-box" style="margin-top:12px;"></div>
    <div class="save-row">
      <button class="btn btn-green" onclick="manualSave()"> СОХРАНИТЬ</button>
    </div>
  </div>

  <!-- КАРТА РАЙОНОВ / КАРЬЕРА -->
  <div id="screen-districts" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Карта районов</span><span id="district-rep-label"></span></div>
    <div class="heat-strip" id="district-heat"></div>
    <div class="district-grid" id="district-grid"></div>
  </div>

  <!-- ЕЖЕДНЕВНЫЕ КОНТРАКТЫ -->
  <div id="screen-contracts" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Контракты синдиката</span><span id="contract-reset-label"></span></div>
    <div class="list-container" id="contract-list"></div>
  </div>

  <!-- ДОСТИЖЕНИЯ -->
  <div id="screen-achievements" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Достижения</span></div>
    <div class="list-container" id="ach-list"></div>
  </div>

  <!-- КЕЙСЫ -->
  <div id="screen-cases" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Кейсы синдиката</span></div>
    <div class="list-container" id="cases-list"></div>
  </div>

  <!-- РЕЙТИНГ -->
  <div id="screen-leaderboard" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Игроки синдиката</span></div>
    <div class="player-lb-head">Глобальная таблица сезона · лучшие пилоты Карбонового района</div>
    <div class="list-container" id="lb-list"></div>
  </div>

  <!-- РЫНОК -->
  <div id="screen-market" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Рынок игроков</span></div>
    <div class="market-tabs">
      <div class="subtab-btn active" id="msub-browse" onclick="switchMarketSub('browse')">Купить</div>
      <div class="subtab-btn" id="msub-sell" onclick="switchMarketSub('sell')">Продать</div>
    </div>
    <div id="market-browse-wrap" class="list-container">
      <div class="chat-status" id="market-status">Подключение к рынку…</div>
      <div class="list-container" id="market-list"></div>
    </div>
    <div id="market-sell-wrap" class="list-container" style="display:none;">
      <div class="sell-picker" id="sell-picker"></div>
      <div class="section-title" style="margin-top:4px;"><span>Мои лоты</span></div>
      <div class="list-container" id="market-mine-list"></div>
    </div>
  </div>

  <!-- ЧАТ -->
  <div id="screen-chat" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Чат синдиката</span></div>
    <div class="chat-status" id="chat-status">Подключение…</div>
    <div class="chat-wrap">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <input class="chat-input" id="chat-input" maxlength="300" placeholder="Написать в чат…" onkeydown="if(event.key==='Enter')sendChatMessage()">
        <button class="chat-send-btn" onclick="sendChatMessage()"></button>
      </div>
    </div>
  </div>

  <!-- НАСТРОЙКИ -->
  <div id="screen-settings" class="screen">
    <div class="back-link" onclick="switchTab('profile')">← Профиль</div>
    <div class="section-title"><span>Настройки</span></div>
    <div class="setting-row"><div><b>Звук</b><span>Звуковые эффекты интерфейса</span></div><div class="switch" id="set-sound" onclick="toggleSetting('sound')"><div class="knob"></div></div></div>
    <div class="setting-row"><div><b>Анимации</b><span>Эффекты выигрыша и переходов</span></div><div class="switch" id="set-anim" onclick="toggleSetting('animations')"><div class="knob"></div></div></div>
    <div class="setting-row"><div><b>Тактильная отдача</b><span>Вибрация Telegram при переключениях и действиях</span></div><div class="switch" id="set-haptics" onclick="toggleSetting('haptics')"><div class="knob"></div></div></div>
    <div class="setting-row"><div><b>Режим производительности</b><span>Снижает нагрузку эффектов и сохраняет плавность</span></div><div class="switch" id="set-reduced-motion" onclick="toggleSetting('reducedMotion')"><div class="knob"></div></div></div>
    <div class="setting-row"><div><b>Компактный HUD</b><span>Меньше подсказок во время заезда</span></div><div class="switch" id="set-compact-hud" onclick="toggleSetting('compactHud')"><div class="knob"></div></div></div>
    <div class="setting-row"><div><b>Резервная копия</b><span>Сохранить копию игрового прогресса</span></div><button class="btn btn-ghost" style="width:auto;padding:9px 14px;" onclick="exportSave()">СОХРАНИТЬ</button></div>
    <div class="setting-row"><div><b>Восстановление</b><span>Загрузить резервную копию прогресса</span></div><label class="btn btn-ghost" style="width:auto;padding:9px 14px;cursor:pointer;">ЗАГРУЗИТЬ<input type="file" accept="application/json" style="display:none" onchange="importSave(event)"></label></div>
    <div class="setting-row"><div><b>Новая карьера</b><span>Начать путь заново с чистого гаража</span></div><button class="btn btn-select" style="width:auto;padding:9px 14px;background:var(--accent);" onclick="resetProgress()">НАЧАТЬ ЗАНОВО</button></div>
    <div class="progress-save-note">Прогресс сохраняется автоматически · <span id="last-saved-text">—</span></div>
  </div>

</main>

<nav>
  <div class="nav-btn active" onclick="switchTab('garage')" data-tab="garage"><span class="ic">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l1.5-5A2 2 0 0 1 6.4 4.5h11.2A2 2 0 0 1 19.5 6l1.5 5"/><rect x="2.5" y="11" width="19" height="7" rx="1.5"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>
  </span>Гараж</div>
  <div class="nav-btn" onclick="switchTab('shop')" data-tab="shop"><span class="ic">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M9 20v-6h6v6"/></svg>
  </span>Салон</div>
  <div class="nav-btn" onclick="switchTab('duel-select')" data-tab="duel-select"><span class="ic">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v18"/><path d="M5 4h6l-1 3 1 3H5"/><path d="M13 5h4l-1 2.5L17 10h-4"/></svg>
  </span>Дуэль</div>
  <div class="nav-btn" onclick="switchTab('casino')" data-tab="casino"><span class="ic">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
  </span>Казино</div>
  <div class="nav-btn" onclick="switchTab('profile')" data-tab="profile"><span class="ic" id="nav-profile-ic">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c1.5-4 4.5-6 7.5-6s6 2 7.5 6"/></svg>
  </span>Профиль</div>
</nav>

<div id="daily-modal-root"></div>
<div id="police-modal-root"></div>
<div id="money-modal-root"></div>
<div id="public-profile-root"></div>









`;
