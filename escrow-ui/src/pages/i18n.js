// ═══════════════════════════════════════════════════════════════════════
// i18n.js — Internationalization for Fedi Escrow
// English • Français • Português • Kiswahili
// ═══════════════════════════════════════════════════════════════════════
//
// Usage in EcashEscrow.jsx:
//   import { t, setLocale, getLocale, getAvailableLocales } from "./i18n";
//   t("newTrade")  →  "New Trade" / "Nouvelle transaction" / etc.
//
// The locale is auto-detected from navigator.language and persisted
// in localStorage. Users can also switch manually via a lang picker.
// ═══════════════════════════════════════════════════════════════════════

const translations = {

  // ─────────────────────────────────────────────────────────────────────
  // ENGLISH
  // ─────────────────────────────────────────────────────────────────────
  en: {
    // ── Onboarding (Fedi app) ──────────────────────────────────────────
    ob1Title: "Trustless P2P Trading",
    ob1Desc: "Trade anything for bitcoin without trusting the other side. Your sats are locked in federated e-cash escrow until both parties agree the deal is done.",
    ob2Title: "3 Parties, 2-of-3 Vote",
    ob2Desc: "Every trade has a Seller, Buyer, and a vetted Arbiter chosen by the community. Two must agree to release or refund. If buyer and seller agree, the arbiter is never needed.",
    ob3Title: "Instant Lightning Payout",
    ob3Desc: "Sats are locked via Lightning and paid out instantly. No on-chain fees, no waiting. All powered by your Fedi federation.",
    obStartTrading: "Start Trading",
    obNext: "Next",
    obSkip: "Skip",
    obFedLimit: "Federation limit: {limit} sats per trade",

    // ── Onboarding (Sandbox / browser) ─────────────────────────────────
    obSandboxTitle: "Welcome to the Escrow Sandbox",
    obSandboxDesc: "This is a live demo of our 2-of-3 multisig escrow — powered by Fedimint and Lightning. Try every role: create escrows, fund them, vote, and claim. No real sats, no risk.",
    obRolesTitle: "Play Every Role",
    obRolesDesc: "Switch between Seller, Buyer, and Arbiter using the role bar at the top. Each role sees a different view — just like a real trade. Walk through a full escrow lifecycle in minutes.",
    obCommunityTitle: "Ready for Real Trades?",
    obCommunityDesc: "When you're ready to trade real sats, join our community on Fedi. Chat with traders, learn the rules, and start your first escrow — all inside the federation.",
    sandboxBadge: "SANDBOX MODE",
    sandboxFooter: "No real sats. Explore freely.",
    tryDemo: "Try the Demo",
    sandbox: "Sandbox",
    playAs: "Play as:",

    // ── List View ──────────────────────────────────────────────────────
    escrow: "Federated Escrow",
    newTrade: "New Trade",
    joinEscrow: "Join Trade",
    noEscrows: "No trades yet. Create one or join an existing trade.",
    sats: "sats",
    maxPerTrade: "Max {limit} sats per trade",
    failedLoadEscrows: "Failed to load trades",

    // ── Create View ────────────────────────────────────────────────────
    amountSats: "Amount (sats)",
    description: "Description",
    tradeTerms: "Trade Terms",
    communityLink: "Community Chat Link",
    communityLinkHint: "Fedi room link where parties can communicate",
    maxFedLimit: "Federation limit: {limit} sats",
    creating: "Creating...",
    createEscrow: "Create Escrow",
    escrowCreated: "Escrow created!",

    // ── How It Works ───────────────────────────────────────────────────
    howItWorks: "How It Works",
    howStep1: "You create the escrow and become the",
    howStep1Role: "Seller",
    howStep2: "A Buyer and Arbiter join using the escrow ID.",
    howStep3: "You lock sats via Lightning. Buyer completes their side.",
    howStep4: "Both vote. If they agree, sats move instantly.",
    howStep5: "If they disagree, the Arbiter casts the deciding vote.",

    // ── Join View ──────────────────────────────────────────────────────
    escrowId: "Escrow ID",
    escrowIdPlaceholder: "e.g. ecash_23",
    yourRole: "Your Role",
    buyer: "Buyer",
    arbiter: "Arbiter",
    seller: "Seller",
    joining: "Joining...",
    joinAs: "Join as {role}",
    joinedAs: "Joined as {role}!",
    buyerDesc: "Complete trade obligations, then vote to release sats to yourself or refund the seller.",
    arbiterDesc: "Review evidence and cast the deciding vote only if buyer and seller disagree.",
    arbiterRestricted: "Arbiter restricted",
    arbiterRestrictedDesc: "Only pre-approved community arbiters can join trades. Apply in the community chat.",

    // ── Detail View ────────────────────────────────────────────────────
    youAreThe: "You are the",
    connectingNostr: "Connecting to Nostr...",

    // ── Share Prompt ───────────────────────────────────────────────────
    shareEscrowTitle: "Share this Escrow ID",
    shareEscrowDesc: "Send the ID to the buyer and arbiter so they can join.",
    copyId: "Copy ID",
    openCommunity: "Open Chat",

    // ── Lock ───────────────────────────────────────────────────────────
    lockSats: "Lock {amount} sats",
    locking: "Locking...",
    satsLocked: "Sats locked in escrow!",
    confirmInFedi: "Confirm payment in Fedi",
    paymentCancelled: "Payment cancelled",
    lockedDevMode: "Locked (sandbox mode)",
    readyToLock: "Ready to lock",
    securedInVault: "Secured in vault",

    // ── Voting ─────────────────────────────────────────────────────────
    release: "Release to Buyer",
    refund: "Refund to Seller",
    confirm: "Confirm",
    dispute: "Dispute",
    noDispute: "No dispute — trade complete",
    voting: "Voting...",
    votedRelease: "Voted: release to buyer",
    votedRefund: "Voted: refund to seller",
    confirmRelease: "Confirm — release sats to buyer?",
    resolvedRelease: "Resolved: release to buyer",
    resolvedRefund: "Resolved: refund to seller",

    // ── Claim / Payout ─────────────────────────────────────────────────
    claimSats: "Claim {amount} sats",
    claiming: "Claiming...",
    claimed: "Claimed! Payout in progress.",
    readyToClaim: "Ready to claim",
    invoiceCancelled: "Invoice creation cancelled",
    sendingPayout: "Sending payout...",
    satsReceived: "Sats received!",
    satsDelivered: "{amount} sats delivered",
    notesCopied: "E-cash notes copied!",
    sandboxPayout: "🧪 Sandbox: sats claimed!",
    deliveredToBuyer: "Delivered to buyer",
    refundedToSeller: "Refunded to seller",

    // ── Status / Wait Banners ──────────────────────────────────────────
    waitParties: "Waiting for all parties to join",
    waitingAllParties: "Waiting for all parties",
    waitSellerLock: "Waiting for seller to lock sats",
    waitBuyerVote: "Waiting for buyer to vote",
    waitSeller: "Waiting for seller to vote",
    waitBothVote: "Waiting for both parties to vote",
    waitResolution: "Waiting for resolution",
    tradeComplete: "Trade complete",
    tradeCompleteBanner: "Trade completed",
    escrowExpired: "Escrow expired",

    // ── Chat / Community ───────────────────────────────────────────────
    joinChat: "Join the Community Chat",

    // ── Learn More (Sandbox) ───────────────────────────────────────────
    learnMoreTitle: "New to Bitcoin or Fedi?",
    learnFedi: "What is Fedi?",
    learnBitcoin: "What is Bitcoin?",
    scanToDownload: "Scan to download Fedi",

    // ── Misc ───────────────────────────────────────────────────────────
    copied: "{label} copied!",
    copyFailed: "Copy failed",
    "2d": "2-of-3",
  },

  // ─────────────────────────────────────────────────────────────────────
  // FRANÇAIS
  // ─────────────────────────────────────────────────────────────────────
  fr: {
    // ── Intégration (app Fedi) ─────────────────────────────────────────
    ob1Title: "Échanges P2P sans confiance",
    ob1Desc: "Échangez n'importe quoi contre du bitcoin sans faire confiance à l'autre partie. Vos sats sont verrouillés dans un séquestre fédéré e-cash jusqu'à ce que les deux parties confirment.",
    ob2Title: "3 Parties, vote 2-sur-3",
    ob2Desc: "Chaque échange a un Vendeur, un Acheteur et un Arbitre approuvé par la communauté. Deux doivent s'accorder pour libérer ou rembourser. Si l'acheteur et le vendeur sont d'accord, l'arbitre n'intervient jamais.",
    ob3Title: "Paiement Lightning instantané",
    ob3Desc: "Les sats sont verrouillés via Lightning et payés instantanément. Aucun frais on-chain, aucune attente. Tout est propulsé par votre fédération Fedi.",
    obStartTrading: "Commencer à échanger",
    obNext: "Suivant",
    obSkip: "Passer",
    obFedLimit: "Limite fédération : {limit} sats par échange",

    // ── Intégration (Sandbox / navigateur) ─────────────────────────────
    obSandboxTitle: "Bienvenue dans le bac à sable",
    obSandboxDesc: "Ceci est une démo en direct de notre séquestre multisig 2-sur-3 — propulsé par Fedimint et Lightning. Essayez chaque rôle : créez des séquestres, financez-les, votez et réclamez. Pas de vrais sats, aucun risque.",
    obRolesTitle: "Jouez chaque rôle",
    obRolesDesc: "Basculez entre Vendeur, Acheteur et Arbitre avec la barre de rôle en haut. Chaque rôle a une vue différente — comme dans un vrai échange. Parcourez un cycle complet en quelques minutes.",
    obCommunityTitle: "Prêt pour de vrais échanges ?",
    obCommunityDesc: "Quand vous êtes prêt à échanger de vrais sats, rejoignez notre communauté sur Fedi. Discutez avec des traders, apprenez les règles et lancez votre premier séquestre.",
    sandboxBadge: "MODE BAC À SABLE",
    sandboxFooter: "Pas de vrais sats. Explorez librement.",
    tryDemo: "Essayer la démo",
    sandbox: "Bac à sable",
    playAs: "Jouer en tant que :",

    // ── Vue liste ──────────────────────────────────────────────────────
    escrow: "Séquestre fédéré",
    newTrade: "Nouvel échange",
    joinEscrow: "Rejoindre",
    noEscrows: "Aucun échange. Créez-en un ou rejoignez un échange existant.",
    sats: "sats",
    maxPerTrade: "Max {limit} sats par échange",
    failedLoadEscrows: "Échec du chargement des échanges",

    // ── Vue création ───────────────────────────────────────────────────
    amountSats: "Montant (sats)",
    description: "Description",
    tradeTerms: "Conditions de l'échange",
    communityLink: "Lien du chat communautaire",
    communityLinkHint: "Lien de la salle Fedi où les parties peuvent communiquer",
    maxFedLimit: "Limite fédération : {limit} sats",
    creating: "Création...",
    createEscrow: "Créer le séquestre",
    escrowCreated: "Séquestre créé !",

    // ── Comment ça marche ──────────────────────────────────────────────
    howItWorks: "Comment ça marche",
    howStep1: "Vous créez le séquestre et devenez le",
    howStep1Role: "Vendeur",
    howStep2: "Un Acheteur et un Arbitre rejoignent avec l'ID du séquestre.",
    howStep3: "Vous verrouillez les sats via Lightning. L'acheteur remplit sa part.",
    howStep4: "Les deux votent. S'ils sont d'accord, les sats sont transférés.",
    howStep5: "En cas de désaccord, l'Arbitre tranche.",

    // ── Vue rejoindre ──────────────────────────────────────────────────
    escrowId: "ID du séquestre",
    escrowIdPlaceholder: "ex. ecash_23",
    yourRole: "Votre rôle",
    buyer: "Acheteur",
    arbiter: "Arbitre",
    seller: "Vendeur",
    joining: "En cours...",
    joinAs: "Rejoindre comme {role}",
    joinedAs: "Rejoint comme {role} !",
    buyerDesc: "Remplissez vos obligations, puis votez pour libérer les sats ou rembourser le vendeur.",
    arbiterDesc: "Examinez les preuves et votez uniquement si l'acheteur et le vendeur ne sont pas d'accord.",
    arbiterRestricted: "Arbitre restreint",
    arbiterRestrictedDesc: "Seuls les arbitres approuvés par la communauté peuvent rejoindre. Postulez dans le chat.",

    // ── Vue détail ─────────────────────────────────────────────────────
    youAreThe: "Vous êtes le",
    connectingNostr: "Connexion à Nostr...",

    // ── Partage ────────────────────────────────────────────────────────
    shareEscrowTitle: "Partagez cet ID de séquestre",
    shareEscrowDesc: "Envoyez l'ID à l'acheteur et à l'arbitre pour qu'ils puissent rejoindre.",
    copyId: "Copier l'ID",
    openCommunity: "Ouvrir le chat",

    // ── Verrouillage ───────────────────────────────────────────────────
    lockSats: "Verrouiller {amount} sats",
    locking: "Verrouillage...",
    satsLocked: "Sats verrouillés dans le séquestre !",
    confirmInFedi: "Confirmez le paiement dans Fedi",
    paymentCancelled: "Paiement annulé",
    lockedDevMode: "Verrouillé (mode bac à sable)",
    readyToLock: "Prêt à verrouiller",
    securedInVault: "Sécurisé dans le coffre",

    // ── Vote ───────────────────────────────────────────────────────────
    release: "Libérer à l'acheteur",
    refund: "Rembourser le vendeur",
    confirm: "Confirmer",
    dispute: "Contester",
    noDispute: "Pas de litige — échange terminé",
    voting: "Vote...",
    votedRelease: "Voté : libérer à l'acheteur",
    votedRefund: "Voté : rembourser le vendeur",
    confirmRelease: "Confirmer — libérer les sats à l'acheteur ?",
    resolvedRelease: "Résolu : libéré à l'acheteur",
    resolvedRefund: "Résolu : remboursé au vendeur",

    // ── Réclamation / Paiement ─────────────────────────────────────────
    claimSats: "Réclamer {amount} sats",
    claiming: "Réclamation...",
    claimed: "Réclamé ! Paiement en cours.",
    readyToClaim: "Prêt à réclamer",
    invoiceCancelled: "Création de la facture annulée",
    sendingPayout: "Envoi du paiement...",
    satsReceived: "Sats reçus !",
    satsDelivered: "{amount} sats livrés",
    notesCopied: "Notes e-cash copiées !",
    sandboxPayout: "🧪 Bac à sable : sats réclamés !",
    deliveredToBuyer: "Livré à l'acheteur",
    refundedToSeller: "Remboursé au vendeur",

    // ── Statut / Bannières d'attente ───────────────────────────────────
    waitParties: "En attente de toutes les parties",
    waitingAllParties: "En attente des participants",
    waitSellerLock: "En attente du verrouillage par le vendeur",
    waitBuyerVote: "En attente du vote de l'acheteur",
    waitSeller: "En attente du vote du vendeur",
    waitBothVote: "En attente du vote des deux parties",
    waitResolution: "En attente de résolution",
    tradeComplete: "Échange terminé",
    tradeCompleteBanner: "Échange terminé",
    escrowExpired: "Séquestre expiré",

    // ── Chat / Communauté ──────────────────────────────────────────────
    joinChat: "Rejoindre le chat communautaire",

    // ── En savoir plus (Sandbox) ───────────────────────────────────────
    learnMoreTitle: "Nouveau sur Bitcoin ou Fedi ?",
    learnFedi: "C'est quoi Fedi ?",
    learnBitcoin: "C'est quoi Bitcoin ?",
    scanToDownload: "Scannez pour télécharger Fedi",

    // ── Divers ─────────────────────────────────────────────────────────
    copied: "{label} copié !",
    copyFailed: "Échec de la copie",
    "2d": "2-sur-3",
  },

  // ─────────────────────────────────────────────────────────────────────
  // PORTUGUÊS
  // ─────────────────────────────────────────────────────────────────────
  pt: {
    // ── Integração (app Fedi) ──────────────────────────────────────────
    ob1Title: "Negociação P2P sem confiança",
    ob1Desc: "Negocie qualquer coisa por bitcoin sem confiar na outra parte. Seus sats ficam bloqueados em custódia federada de e-cash até que ambas as partes confirmem o acordo.",
    ob2Title: "3 Partes, voto 2-de-3",
    ob2Desc: "Cada negociação tem um Vendedor, um Comprador e um Árbitro aprovado pela comunidade. Dois devem concordar para liberar ou reembolsar. Se comprador e vendedor concordarem, o árbitro nunca é necessário.",
    ob3Title: "Pagamento Lightning instantâneo",
    ob3Desc: "Sats são bloqueados via Lightning e pagos instantaneamente. Sem taxas on-chain, sem espera. Tudo alimentado pela sua federação Fedi.",
    obStartTrading: "Começar a negociar",
    obNext: "Próximo",
    obSkip: "Pular",
    obFedLimit: "Limite da federação: {limit} sats por negociação",

    // ── Integração (Sandbox / navegador) ───────────────────────────────
    obSandboxTitle: "Bem-vindo ao Sandbox de Custódia",
    obSandboxDesc: "Esta é uma demo ao vivo da nossa custódia multisig 2-de-3 — alimentada por Fedimint e Lightning. Experimente cada papel: crie custódias, financie, vote e reclame. Sem sats reais, sem risco.",
    obRolesTitle: "Experimente cada papel",
    obRolesDesc: "Alterne entre Vendedor, Comprador e Árbitro usando a barra de papéis no topo. Cada papel tem uma visão diferente — como numa negociação real. Complete um ciclo inteiro em minutos.",
    obCommunityTitle: "Pronto para negociações reais?",
    obCommunityDesc: "Quando estiver pronto para negociar sats reais, junte-se à nossa comunidade no Fedi. Converse com traders, aprenda as regras e inicie sua primeira custódia.",
    sandboxBadge: "MODO SANDBOX",
    sandboxFooter: "Sem sats reais. Explore livremente.",
    tryDemo: "Experimentar a demo",
    sandbox: "Sandbox",
    playAs: "Jogar como:",

    // ── Vista de lista ─────────────────────────────────────────────────
    escrow: "Custódia federada",
    newTrade: "Nova negociação",
    joinEscrow: "Participar",
    noEscrows: "Sem negociações. Crie uma ou junte-se a uma existente.",
    sats: "sats",
    maxPerTrade: "Máx {limit} sats por negociação",
    failedLoadEscrows: "Falha ao carregar negociações",

    // ── Vista de criação ───────────────────────────────────────────────
    amountSats: "Valor (sats)",
    description: "Descrição",
    tradeTerms: "Termos da negociação",
    communityLink: "Link do chat da comunidade",
    communityLinkHint: "Link da sala Fedi onde as partes podem se comunicar",
    maxFedLimit: "Limite da federação: {limit} sats",
    creating: "Criando...",
    createEscrow: "Criar custódia",
    escrowCreated: "Custódia criada!",

    // ── Como funciona ──────────────────────────────────────────────────
    howItWorks: "Como funciona",
    howStep1: "Você cria a custódia e se torna o",
    howStep1Role: "Vendedor",
    howStep2: "Um Comprador e um Árbitro participam usando o ID da custódia.",
    howStep3: "Você bloqueia sats via Lightning. O comprador cumpre sua parte.",
    howStep4: "Ambos votam. Se concordarem, os sats são transferidos.",
    howStep5: "Se discordarem, o Árbitro dá o voto decisivo.",

    // ── Vista de participação ──────────────────────────────────────────
    escrowId: "ID da custódia",
    escrowIdPlaceholder: "ex. ecash_23",
    yourRole: "Seu papel",
    buyer: "Comprador",
    arbiter: "Árbitro",
    seller: "Vendedor",
    joining: "Entrando...",
    joinAs: "Entrar como {role}",
    joinedAs: "Entrou como {role}!",
    buyerDesc: "Cumpra suas obrigações e vote para liberar os sats para si ou reembolsar o vendedor.",
    arbiterDesc: "Analise as evidências e vote apenas se comprador e vendedor discordarem.",
    arbiterRestricted: "Árbitro restrito",
    arbiterRestrictedDesc: "Apenas árbitros aprovados pela comunidade podem participar. Candidate-se no chat.",

    // ── Vista de detalhes ──────────────────────────────────────────────
    youAreThe: "Você é o",
    connectingNostr: "Conectando ao Nostr...",

    // ── Compartilhamento ───────────────────────────────────────────────
    shareEscrowTitle: "Compartilhe este ID de custódia",
    shareEscrowDesc: "Envie o ID ao comprador e ao árbitro para que possam participar.",
    copyId: "Copiar ID",
    openCommunity: "Abrir chat",

    // ── Bloqueio ───────────────────────────────────────────────────────
    lockSats: "Bloquear {amount} sats",
    locking: "Bloqueando...",
    satsLocked: "Sats bloqueados na custódia!",
    confirmInFedi: "Confirme o pagamento no Fedi",
    paymentCancelled: "Pagamento cancelado",
    lockedDevMode: "Bloqueado (modo sandbox)",
    readyToLock: "Pronto para bloquear",
    securedInVault: "Protegido no cofre",

    // ── Votação ────────────────────────────────────────────────────────
    release: "Liberar ao comprador",
    refund: "Reembolsar o vendedor",
    confirm: "Confirmar",
    dispute: "Contestar",
    noDispute: "Sem disputa — negociação concluída",
    voting: "Votando...",
    votedRelease: "Votou: liberar ao comprador",
    votedRefund: "Votou: reembolsar o vendedor",
    confirmRelease: "Confirmar — liberar sats ao comprador?",
    resolvedRelease: "Resolvido: liberado ao comprador",
    resolvedRefund: "Resolvido: reembolsado ao vendedor",

    // ── Reivindicação / Pagamento ──────────────────────────────────────
    claimSats: "Reivindicar {amount} sats",
    claiming: "Reivindicando...",
    claimed: "Reivindicado! Pagamento em andamento.",
    readyToClaim: "Pronto para reivindicar",
    invoiceCancelled: "Criação da fatura cancelada",
    sendingPayout: "Enviando pagamento...",
    satsReceived: "Sats recebidos!",
    satsDelivered: "{amount} sats entregues",
    notesCopied: "Notas e-cash copiadas!",
    sandboxPayout: "🧪 Sandbox: sats reivindicados!",
    deliveredToBuyer: "Entregue ao comprador",
    refundedToSeller: "Reembolsado ao vendedor",

    // ── Status / Banners de espera ─────────────────────────────────────
    waitParties: "Aguardando todas as partes",
    waitingAllParties: "Aguardando participantes",
    waitSellerLock: "Aguardando o vendedor bloquear os sats",
    waitBuyerVote: "Aguardando o voto do comprador",
    waitSeller: "Aguardando o voto do vendedor",
    waitBothVote: "Aguardando o voto de ambas as partes",
    waitResolution: "Aguardando resolução",
    tradeComplete: "Negociação concluída",
    tradeCompleteBanner: "Negociação concluída",
    escrowExpired: "Custódia expirada",

    // ── Chat / Comunidade ──────────────────────────────────────────────
    joinChat: "Entrar no chat da comunidade",

    // ── Saiba mais (Sandbox) ───────────────────────────────────────────
    learnMoreTitle: "Novo no Bitcoin ou Fedi?",
    learnFedi: "O que é Fedi?",
    learnBitcoin: "O que é Bitcoin?",
    scanToDownload: "Escaneie para baixar o Fedi",

    // ── Diversos ───────────────────────────────────────────────────────
    copied: "{label} copiado!",
    copyFailed: "Falha ao copiar",
    "2d": "2-de-3",
  },

  // ─────────────────────────────────────────────────────────────────────
  // KISWAHILI
  // ─────────────────────────────────────────────────────────────────────
  sw: {
    // ── Utangulizi (app ya Fedi) ───────────────────────────────────────
    ob1Title: "Biashara ya P2P bila kuamini",
    ob1Desc: "Fanya biashara yoyote kwa bitcoin bila kuamini upande mwingine. Sats zako zimefungwa katika escrow ya e-cash ya shirikisho hadi pande zote mbili zikubaliane.",
    ob2Title: "Watu 3, kura ya 2-kati-ya-3",
    ob2Desc: "Kila biashara ina Muuzaji, Mnunuzi, na Msuluhishi aliyeidhinishwa na jamii. Wawili lazima wakubaliane. Muuzaji na mnunuzi wakikubaliana, msuluhishi hahitajiki.",
    ob3Title: "Malipo ya Lightning papo hapo",
    ob3Desc: "Sats zinafungwa kupitia Lightning na kulipwa papo hapo. Hakuna ada za on-chain, hakuna kusubiri. Yote yanatumia shirikisho lako la Fedi.",
    obStartTrading: "Anza biashara",
    obNext: "Ifuatayo",
    obSkip: "Ruka",
    obFedLimit: "Kikomo cha shirikisho: sats {limit} kwa biashara",

    // ── Utangulizi (Sandbox / kivinjari) ───────────────────────────────
    obSandboxTitle: "Karibu kwenye Sandbox ya Escrow",
    obSandboxDesc: "Hii ni demo ya moja kwa moja ya escrow yetu ya multisig 2-kati-ya-3 — inayotumia Fedimint na Lightning. Jaribu kila jukumu: tengeneza escrow, weka fedha, piga kura na dai. Hakuna sats halisi, hakuna hatari.",
    obRolesTitle: "Cheza kila jukumu",
    obRolesDesc: "Badilisha kati ya Muuzaji, Mnunuzi na Msuluhishi kwa kutumia upau wa majukumu juu. Kila jukumu lina mtazamo tofauti — kama biashara halisi. Pita mzunguko mzima katika dakika chache.",
    obCommunityTitle: "Uko tayari kwa biashara halisi?",
    obCommunityDesc: "Ukiwa tayari kufanya biashara kwa sats halisi, jiunge na jamii yetu kwenye Fedi. Ongea na wafanyabiashara, jifunze sheria na anza escrow yako ya kwanza.",
    sandboxBadge: "HALI YA SANDBOX",
    sandboxFooter: "Hakuna sats halisi. Chunguza kwa uhuru.",
    tryDemo: "Jaribu demo",
    sandbox: "Sandbox",
    playAs: "Cheza kama:",

    // ── Orodha ─────────────────────────────────────────────────────────
    escrow: "Escrow ya shirikisho",
    newTrade: "Biashara mpya",
    joinEscrow: "Jiunge",
    noEscrows: "Hakuna biashara bado. Tengeneza moja au jiunge na iliyopo.",
    sats: "sats",
    maxPerTrade: "Upeo sats {limit} kwa biashara",
    failedLoadEscrows: "Imeshindwa kupakia biashara",

    // ── Tengeneza ──────────────────────────────────────────────────────
    amountSats: "Kiasi (sats)",
    description: "Maelezo",
    tradeTerms: "Masharti ya biashara",
    communityLink: "Kiungo cha mazungumzo ya jamii",
    communityLinkHint: "Kiungo cha chumba cha Fedi ambapo wahusika wanaweza kuwasiliana",
    maxFedLimit: "Kikomo cha shirikisho: sats {limit}",
    creating: "Inatengeneza...",
    createEscrow: "Tengeneza escrow",
    escrowCreated: "Escrow imetengenezwa!",

    // ── Jinsi inavyofanya kazi ─────────────────────────────────────────
    howItWorks: "Jinsi inavyofanya kazi",
    howStep1: "Unatengeneza escrow na kuwa",
    howStep1Role: "Muuzaji",
    howStep2: "Mnunuzi na Msuluhishi wanajiunga kwa kutumia ID ya escrow.",
    howStep3: "Unafunga sats kupitia Lightning. Mnunuzi anakamilisha upande wake.",
    howStep4: "Wote wanapiga kura. Wakikubaliana, sats zinahamishwa papo hapo.",
    howStep5: "Wasipokubaliana, Msuluhishi anapiga kura ya mwisho.",

    // ── Jiunge ─────────────────────────────────────────────────────────
    escrowId: "ID ya escrow",
    escrowIdPlaceholder: "mf. ecash_23",
    yourRole: "Jukumu lako",
    buyer: "Mnunuzi",
    arbiter: "Msuluhishi",
    seller: "Muuzaji",
    joining: "Inajiunga...",
    joinAs: "Jiunge kama {role}",
    joinedAs: "Umejiunga kama {role}!",
    buyerDesc: "Kamilisha wajibu wako, kisha piga kura kuachilia sats au kurudisha kwa muuzaji.",
    arbiterDesc: "Kagua ushahidi na piga kura ya mwisho tu ikiwa mnunuzi na muuzaji hawakubaliani.",
    arbiterRestricted: "Msuluhishi amezuiwa",
    arbiterRestrictedDesc: "Ni wasuluhishi walioidhinishwa na jamii pekee wanaoweza kujiunga. Omba kwenye mazungumzo ya jamii.",

    // ── Maelezo ────────────────────────────────────────────────────────
    youAreThe: "Wewe ni",
    connectingNostr: "Inaunganisha na Nostr...",

    // ── Shiriki ────────────────────────────────────────────────────────
    shareEscrowTitle: "Shiriki ID hii ya escrow",
    shareEscrowDesc: "Tuma ID kwa mnunuzi na msuluhishi ili waweze kujiunga.",
    copyId: "Nakili ID",
    openCommunity: "Fungua mazungumzo",

    // ── Kufunga ────────────────────────────────────────────────────────
    lockSats: "Funga sats {amount}",
    locking: "Inafunga...",
    satsLocked: "Sats zimefungwa kwenye escrow!",
    confirmInFedi: "Thibitisha malipo kwenye Fedi",
    paymentCancelled: "Malipo yameghairiwa",
    lockedDevMode: "Imefungwa (hali ya sandbox)",
    readyToLock: "Tayari kufunga",
    securedInVault: "Imethibitishwa kwenye kabati",

    // ── Kupiga kura ────────────────────────────────────────────────────
    release: "Achilia kwa mnunuzi",
    refund: "Rudisha kwa muuzaji",
    confirm: "Thibitisha",
    dispute: "Pingana",
    noDispute: "Hakuna mgogoro — biashara imekamilika",
    voting: "Inapiga kura...",
    votedRelease: "Imepiga kura: achilia kwa mnunuzi",
    votedRefund: "Imepiga kura: rudisha kwa muuzaji",
    confirmRelease: "Thibitisha — achilia sats kwa mnunuzi?",
    resolvedRelease: "Imetatuliwa: imeachiliwa kwa mnunuzi",
    resolvedRefund: "Imetatuliwa: imerudishwa kwa muuzaji",

    // ── Kudai / Malipo ─────────────────────────────────────────────────
    claimSats: "Dai sats {amount}",
    claiming: "Inadai...",
    claimed: "Imedaiwa! Malipo yanaendelea.",
    readyToClaim: "Tayari kudai",
    invoiceCancelled: "Uundaji wa ankara umeghairiwa",
    sendingPayout: "Inatuma malipo...",
    satsReceived: "Sats zimepokelewa!",
    satsDelivered: "Sats {amount} zimetolewa",
    notesCopied: "Noti za e-cash zimenakiliwa!",
    sandboxPayout: "🧪 Sandbox: sats zimedaiwa!",
    deliveredToBuyer: "Imetolewa kwa mnunuzi",
    refundedToSeller: "Imerudishwa kwa muuzaji",

    // ── Hali / Mabango ya kusubiri ─────────────────────────────────────
    waitParties: "Inasubiri wahusika wote",
    waitingAllParties: "Inasubiri washiriki",
    waitSellerLock: "Inasubiri muuzaji afunge sats",
    waitBuyerVote: "Inasubiri kura ya mnunuzi",
    waitSeller: "Inasubiri kura ya muuzaji",
    waitBothVote: "Inasubiri kura za pande zote mbili",
    waitResolution: "Inasubiri uamuzi",
    tradeComplete: "Biashara imekamilika",
    tradeCompleteBanner: "Biashara imekamilika",
    escrowExpired: "Escrow imeisha muda",

    // ── Mazungumzo / Jamii ─────────────────────────────────────────────
    joinChat: "Jiunge na mazungumzo ya jamii",

    // ── Jifunze zaidi (Sandbox) ────────────────────────────────────────
    learnMoreTitle: "Mpya kwenye Bitcoin au Fedi?",
    learnFedi: "Fedi ni nini?",
    learnBitcoin: "Bitcoin ni nini?",
    scanToDownload: "Changanua kupakua Fedi",

    // ── Mengineyo ──────────────────────────────────────────────────────
    copied: "{label} imenakiliwa!",
    copyFailed: "Kunakili kumeshindwa",
    "2d": "2-kati-ya-3",
  },
};

// ═══════════════════════════════════════════════════════════════════════
// Runtime
// ═══════════════════════════════════════════════════════════════════════

const STORAGE_KEY = "fedi-escrow-locale";

function detectLocale() {
  try { const s = localStorage.getItem(STORAGE_KEY); if (s && translations[s]) return s; } catch {}
  const nav = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase();
  if (nav.startsWith("fr")) return "fr";
  if (nav.startsWith("pt")) return "pt";
  if (nav.startsWith("sw")) return "sw";
  return "en";
}

let _locale = detectLocale();

export function t(key, vars = {}) {
  const str = translations[_locale]?.[key] || translations.en?.[key] || key;
  if (!vars || Object.keys(vars).length === 0) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
}

export function setLocale(code) {
  if (!translations[code]) return;
  _locale = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch {}
}

export function getLocale() { return _locale; }

export function getAvailableLocales() {
  return [
    { code: "en", flag: "🇬🇧", label: "English" },
    { code: "fr", flag: "🇫🇷", label: "Français" },
    { code: "pt", flag: "🇧🇷", label: "Português" },
    { code: "sw", flag: "🇰🇪", label: "Kiswahili" },
  ];
}

export default translations;
