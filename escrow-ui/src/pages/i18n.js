// ═══════════════════════════════════════════════════════════════════════
// i18n.js — Internationalization for Fedi Escrow
// English • Français • Español
// ═══════════════════════════════════════════════════════════════════════
//
// Usage in EcashEscrow.jsx:
//   import { t, setLocale, getLocale } from "./i18n";
//   // Then replace string literals: "New Trade" → t("newTrade")
//
// The locale is auto-detected from navigator.language and persisted
// in localStorage. Users can also switch manually via a lang picker.
// ═══════════════════════════════════════════════════════════════════════

const translations = {
  en: {

// ── EN: Sandbox onboarding (browser visitors) ────────────────────

    obSandboxTitle: "Welcome to the Escrow Sandbox",
    obSandboxDesc: "This is a live demo of our 2-of-3 multisig escrow — powered by Fedimint and Lightning. Try every role: create escrows, fund them, vote, and claim. No real sats, no risk.",
    obRolesTitle: "Play Every Role",
    obRolesDesc: "Switch between Seller, Buyer, and Arbiter using the role bar at the top. Each role sees a different view — just like a real trade. Walk through a full escrow lifecycle in minutes.",
    obCommunityTitle: "Ready for Real Trades?",
    obCommunityDesc: "When you're ready to trade real sats, join our community on Fedi. Chat with traders, learn the rules, and start your first escrow — all inside the federation.",
    sandboxBadge: "SANDBOX MODE",
    sandboxFooter: "No real sats. Explore freely.",
    tryDemo: "Try the Demo",
    joinChat: "Join the Community Chat",
    sandbox: "Sandbox",
    playAs: "Play as:",

// ── EN: Share escrow prompt ──────────────────────────────────────

    shareEscrowTitle: "Share this Escrow ID",
    shareEscrowDesc: "Copy the escrow ID above and send it to the buyer and arbiter so they can join. Share it in your community chat or directly with the other participants.",
    copyId: "Copy ID",
    openCommunity: "Open Chat",

// ── EN: Learn more / resources ───────────────────────────────────

    learnMoreTitle: "New to Bitcoin or Fedi?",
    learnMoreDesc: "Get started with these resources",
    learnFedi: "What is Fedi?",
    learnBitcoin: "What is Bitcoin?",
    scanToDownload: "Scan to download Fedi",
    sandboxPayout: "🧪 Sandbox: sats claimed!",

    // ── Onboarding ───────────────────────────────────────────────
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
    obSandboxTitle: "Welcome to the Escrow Sandbox",
    obSandboxDesc: "This is a live demo of our 2-of-3 multisig escrow — powered by Fedimint and Lightning. Try every role: create escrows, fund them, vote, and claim. No real sats, no risk.",
    obRolesTitle: "Play Every Role",
    obRolesDesc: "Switch between Seller, Buyer, and Arbiter using the role bar at the top. Each role sees a different view — just like a real trade. Walk through a full escrow lifecycle in minutes.",
    obCommunityTitle: "Ready for Real Trades?",
    obCommunityDesc: "When you're ready to trade real sats, join our community on Fedi. Chat with traders, learn the rules, and start your first escrow — all inside the federation.",
    sandboxBadge: "SANDBOX MODE",
    sandboxFooter: "No real sats. Explore freely.",
    tryDemo: "Try the Demo",
    joinChat: "Join the Community Chat",
    sandbox: "Sandbox",
    playAs: "Play as:",
    obSandboxTitle: "Welcome to the Escrow Sandbox",
    obSandboxDesc: "This is a live demo of our 2-of-3 multisig escrow — powered by Fedimint and Lightning. Try every role: create escrows, fund them, vote, and claim. No real sats, no risk.",
    obRolesTitle: "Play Every Role",
    obRolesDesc: "Switch between Seller, Buyer, and Arbiter using the role bar at the top. Each role sees a different view — just like a real trade. Walk through a full escrow lifecycle in minutes.",
    obCommunityTitle: "Ready for Real Trades?",
    obCommunityDesc: "When you're ready to trade real sats, join our community on Fedi. Chat with traders, learn the rules, and start your first escrow — all inside the federation.",
    sandboxBadge: "SANDBOX MODE",
    sandboxFooter: "No real sats. Explore freely.",
    tryDemo: "Try the Demo",
    joinChat: "Join the Community Chat",
    sandbox: "Sandbox",
    playAs: "Play as:",

    // ── List View ────────────────────────────────────────────────
    escrow: "Federated Escrow",
    newTrade: "New Trade",
    joinEscrow: "Join Escrow",
    maxPerTrade: "Max {limit} sats per trade",
    noEscrows: "No escrows yet. Create a new trade or join an existing one.",
    sats: "sats",

    // ── Create View ──────────────────────────────────────────────
    amountSats: "Amount (sats)",
    description: "Description",
    tradeTerms: "Trade terms",
    communityLink: "Community link",
    communityLinkHint: "Paste the Fedi room link where this trade was arranged",
    createEscrow: "Create Escrow",
    creating: "Creating…",
    maxFedLimit: "Max {limit} sats per trade (federation limit)",
    howItWorks: "How it works",
    howStep1: "You create the escrow as the",
    howStep1Role: "Seller",
    howStep2: "Share the ID in chat. Buyer and Arbiter join.",
    howStep3: "You lock sats via Lightning.",
    howStep4: "Complete the trade. Both sides vote to release.",
    howStep5: "Buyer claims sats instantly to their wallet.",

// ── EN: Share escrow prompt ──────────────────────────────────────
    shareEscrowTitle: "Share this Escrow ID",
    shareEscrowDesc: "Copy the escrow ID above and send it to the buyer and arbiter so they can join. Share it in your community chat or directly with the other participants.",
    copyId: "Copy ID",
    openCommunity: "Open Chat",

    // ── Join View ────────────────────────────────────────────────
    escrowId: "Escrow ID",
    escrowIdPlaceholder: "Paste the escrow ID from chat",
    yourRole: "Your role",
    buyer: "Buyer",
    arbiter: "Arbiter",
    joinAs: "Join as {role}",
    joining: "Joining…",
    buyerDesc: "You're buying something from the seller. After the trade, you vote to release sats to yourself.",
    arbiterDesc: "A trusted community mediator. Arbiters are vetted members who only vote when buyer and seller disagree. They ensure fair resolution.",
    arbiterRestricted: "Arbiter role restricted.",
    arbiterRestrictedDesc: "Only pre-approved community members can serve as arbiters. Contact a federation guardian if you'd like to be added.",

    // ── Detail View ──────────────────────────────────────────────
    trade: "Trade",
    escrowAmount: "Escrow Amount",
    youAreThe: "You are the",
    participants: "Participants",
    seller: "Seller",
    waiting: "waiting…",
    votesLabel: "Votes",
    release: "Release",
    refund: "Refund",
    resolved: "Resolved",
    resolvedRelease: "Release → Buyer wins",
    resolvedRefund: "Refund → Seller refunded",
    tradeComplete: "Trade Complete",
    satsDelivered: "{amount} sats delivered trustlessly",

    // ── Actions ──────────────────────────────────────────────────
    lockSats: "Lock {amount} sats into escrow",
    locking: "Locking…",
    confirmRelease: "Confirm trade completed — Release",
    voting: "Voting…",
    confirm: "Confirm",
    dispute: "Dispute",
    claimSats: "Claim your {amount} sats",
    claiming: "Claiming…",
    confirmInFedi: "Confirm payment in Fedi…",
    paymentCancelled: "Payment cancelled — tap Lock to try again",
    satsLocked: "Sats locked in escrow!",
    votedRelease: "Voted to release",
    votedRefund: "Voted to refund",
    sendingPayout: "Sending payout…",
    satsReceived: "Sats received!",
    invoiceCancelled: "Invoice cancelled — tap Claim to try again",

    // ── Wait banners ─────────────────────────────────────────────
    waitSeller: "Waiting for seller to respond…",
    waitBuyerVote: "Waiting for buyer to vote first…",
    waitResolution: "Waiting for resolution…",
    waitBothVote: "Waiting for buyer and seller to vote…",
    noDispute: "Buyer and seller agree — no dispute",
    waitSellerLock: "Waiting for seller to lock funds…",
    waitParties: "Waiting for all parties to join…",
    tradeCompleteBanner: "Trade complete — sats paid out!",

    // ── Status ───────────────────────────────────────────────────
    statusCreated: "Waiting for parties",
    statusFunded: "Ready to lock",
    statusLocked: "Funds locked",
    statusApproved: "Resolved",
    statusClaimed: "Claimed",
    statusCompleted: "Complete",
    statusExpired: "Expired",

    // ── Vault ────────────────────────────────────────────────────
    deliveredToBuyer: "Delivered to buyer",
    refundedToSeller: "Refunded to seller",
    readyToClaim: "Ready to claim",
    securedInVault: "Secured in escrow vault",
    readyToLock: "Ready to lock",
    escrowExpired: "Escrow expired",
    waitingAllParties: "Waiting for all parties",

    // ── Misc ─────────────────────────────────────────────────────
    copied: "{label} copied",
    copyFailed: "Copy failed",
    connectingNostr: "Connecting to Nostr identity…",
    failedLoadEscrows: "Failed to load escrows",
    escrowCreated: "Escrow created!",
    joinedAs: "Joined as {role}!",
    lockedDevMode: "Locked (dev mode)",
    notesCopied: "Notes copied to clipboard",
    claimed: "Claimed!",
    dev: "DEV",
  },

  fr: {

// ── FR: Sandbox onboarding ───────────────────────────────────────

    obSandboxTitle: "Bienvenue dans le bac à sable",
    obSandboxDesc: "Ceci est une démo en direct de notre escrow multisig 2-sur-3 — propulsé par Fedimint et Lightning. Essayez chaque rôle : créez des escrows, financez-les, votez et réclamez. Pas de vrais sats, aucun risque.",
    obRolesTitle: "Jouez chaque rôle",
    obRolesDesc: "Basculez entre Vendeur, Acheteur et Arbitre avec la barre de rôle en haut. Chaque rôle a une vue différente — comme dans un vrai échange. Parcourez un cycle complet en quelques minutes.",
    obCommunityTitle: "Prêt pour de vrais échanges ?",
    obCommunityDesc: "Quand vous êtes prêt à échanger de vrais sats, rejoignez notre communauté sur Fedi. Discutez avec des traders, apprenez les règles et lancez votre premier escrow — le tout dans la fédération.",
    sandboxBadge: "MODE BAC À SABLE",
    sandboxFooter: "Pas de vrais sats. Explorez librement.",
    tryDemo: "Essayer la démo",
    joinChat: "Rejoindre le chat communautaire",
    sandbox: "Bac à sable",
    playAs: "Jouer en tant que :",

// ── FR: Share escrow prompt ──────────────────────────────────────

    obSandboxTitle: "Bienvenue dans le bac à sable",
    obSandboxDesc: "Ceci est une démo en direct de notre escrow multisig 2-sur-3 — propulsé par Fedimint et Lightning. Essayez chaque rôle : créez des escrows, financez-les, votez et réclamez. Pas de vrais sats, aucun risque.",
    obRolesTitle: "Jouez chaque rôle",
    obRolesDesc: "Basculez entre Vendeur, Acheteur et Arbitre avec la barre de rôle en haut. Chaque rôle a une vue différente — comme dans un vrai échange. Parcourez un cycle complet en quelques minutes.",
    obCommunityTitle: "Prêt pour de vrais échanges ?",
    obCommunityDesc: "Quand vous êtes prêt à échanger de vrais sats, rejoignez notre communauté sur Fedi. Discutez avec des traders, apprenez les règles et lancez votre premier escrow — le tout dans la fédération.",
    sandboxBadge: "MODE BAC À SABLE",
    sandboxFooter: "Pas de vrais sats. Explorez librement.",
    tryDemo: "Essayer la démo",
    joinChat: "Rejoindre le chat communautaire",
    sandbox: "Bac à sable",
    playAs: "Jouer en tant que :",

// ── FR: Learn more / resources ───────────────────────────────────

    learnMoreTitle: "Nouveau sur Bitcoin ou Fedi ?",
    learnMoreDesc: "Commencez avec ces ressources",
    learnFedi: "Qu'est-ce que Fedi ?",
    learnBitcoin: "Qu'est-ce que Bitcoin ?",
    scanToDownload: "Scannez pour télécharger Fedi",
    sandboxPayout: "🧪 Bac à sable : sats réclamés !",
    shareEscrowTitle: "Partagez cet identifiant d'escrow",
    shareEscrowDesc: "Copiez l'identifiant ci-dessus et envoyez-le à l'acheteur et à l'arbitre pour qu'ils puissent rejoindre. Partagez-le dans votre chat communautaire ou directement avec les participants.",
    copyId: "Copier l'ID",
    openCommunity: "Ouvrir le chat",
    ob1Title: "Échanges P2P sans confiance",
    ob1Desc: "Échangez n'importe quoi contre du bitcoin sans faire confiance à l'autre partie. Vos sats sont verrouillés dans un séquestre fédéré d'e-cash jusqu'à ce que les deux parties acceptent.",
    ob2Title: "3 Parties, Vote 2-sur-3",
    ob2Desc: "Chaque échange a un Vendeur, un Acheteur et un Arbitre vérifié choisi par la communauté. Deux doivent accepter pour libérer ou rembourser. Si acheteur et vendeur sont d'accord, l'arbitre n'est jamais nécessaire.",
    ob3Title: "Paiement Lightning instantané",
    ob3Desc: "Les sats sont verrouillés via Lightning et payés instantanément. Pas de frais on-chain, pas d'attente. Le tout alimenté par votre fédération Fedi.",
    obStartTrading: "Commencer à échanger",
    obNext: "Suivant",
    obSkip: "Passer",
    obFedLimit: "Limite de la fédération : {limit} sats par échange",

    escrow: "Séquestre Fédéré",
    newTrade: "Nouvel échange",
    joinEscrow: "Rejoindre un séquestre",
    maxPerTrade: "Max {limit} sats par échange",
    noEscrows: "Aucun séquestre. Créez un nouvel échange ou rejoignez-en un.",
    sats: "sats",

    amountSats: "Montant (sats)",
    description: "Description",
    tradeTerms: "Conditions de l'échange",
    communityLink: "Lien communautaire",
    communityLinkHint: "Collez le lien du salon Fedi où cet échange a été arrangé",
    createEscrow: "Créer le séquestre",
    creating: "Création…",
    maxFedLimit: "Max {limit} sats par échange (limite de la fédération)",
    howItWorks: "Comment ça marche",
    howStep1: "Vous créez le séquestre en tant que",
    howStep1Role: "Vendeur",
    howStep2: "Partagez l'ID dans le chat. L'Acheteur et l'Arbitre rejoignent.",
    howStep3: "Vous verrouillez les sats via Lightning.",
    howStep4: "Complétez l'échange. Les deux parties votent pour la libération.",
    howStep5: "L'acheteur réclame les sats instantanément.",

    escrowId: "ID du séquestre",
    escrowIdPlaceholder: "Collez l'ID du séquestre depuis le chat",
    yourRole: "Votre rôle",
    buyer: "Acheteur",
    arbiter: "Arbitre",
    joinAs: "Rejoindre en tant que {role}",
    joining: "Connexion…",
    buyerDesc: "Vous achetez quelque chose au vendeur. Après l'échange, vous votez pour libérer les sats vers vous.",
    arbiterDesc: "Un médiateur communautaire de confiance. Les arbitres sont des membres vérifiés qui ne votent que lorsque l'acheteur et le vendeur sont en désaccord.",
    arbiterRestricted: "Rôle d'arbitre restreint.",
    arbiterRestrictedDesc: "Seuls les membres pré-approuvés peuvent servir d'arbitre. Contactez un gardien de la fédération pour être ajouté.",

    trade: "Échange",
    escrowAmount: "Montant du séquestre",
    youAreThe: "Vous êtes le/la",
    participants: "Participants",
    seller: "Vendeur",
    waiting: "en attente…",
    votesLabel: "Votes",
    release: "Libérer",
    refund: "Rembourser",
    resolved: "Résolu",
    resolvedRelease: "Libération → L'acheteur gagne",
    resolvedRefund: "Remboursement → Le vendeur remboursé",
    tradeComplete: "Échange terminé",
    satsDelivered: "{amount} sats livrés sans confiance",

    lockSats: "Verrouiller {amount} sats dans le séquestre",
    locking: "Verrouillage…",
    confirmRelease: "Confirmer l'échange — Libérer",
    voting: "Vote…",
    confirm: "Confirmer",
    dispute: "Contester",
    claimSats: "Réclamer vos {amount} sats",
    claiming: "Réclamation…",
    confirmInFedi: "Confirmez le paiement dans Fedi…",
    paymentCancelled: "Paiement annulé — appuyez à nouveau",
    satsLocked: "Sats verrouillés dans le séquestre !",
    votedRelease: "Voté pour la libération",
    votedRefund: "Voté pour le remboursement",
    sendingPayout: "Envoi du paiement…",
    satsReceived: "Sats reçus !",
    invoiceCancelled: "Facture annulée — appuyez à nouveau",

    waitSeller: "En attente de la réponse du vendeur…",
    waitBuyerVote: "En attente du vote de l'acheteur…",
    waitResolution: "En attente de la résolution…",
    waitBothVote: "En attente des votes de l'acheteur et du vendeur…",
    noDispute: "L'acheteur et le vendeur sont d'accord — pas de litige",
    waitSellerLock: "En attente du verrouillage par le vendeur…",
    waitParties: "En attente de tous les participants…",
    tradeCompleteBanner: "Échange terminé — sats payés !",

    statusCreated: "En attente des parties",
    statusFunded: "Prêt à verrouiller",
    statusLocked: "Fonds verrouillés",
    statusApproved: "Résolu",
    statusClaimed: "Réclamé",
    statusCompleted: "Terminé",
    statusExpired: "Expiré",

    deliveredToBuyer: "Livré à l'acheteur",
    refundedToSeller: "Remboursé au vendeur",
    readyToClaim: "Prêt à réclamer",
    securedInVault: "Sécurisé dans le coffre",
    readyToLock: "Prêt à verrouiller",
    escrowExpired: "Séquestre expiré",
    waitingAllParties: "En attente de tous les participants",

    copied: "{label} copié",
    copyFailed: "Échec de la copie",
    connectingNostr: "Connexion à l'identité Nostr…",
    failedLoadEscrows: "Échec du chargement",
    escrowCreated: "Séquestre créé !",
    joinedAs: "Rejoint en tant que {role} !",
    lockedDevMode: "Verrouillé (mode dev)",
    notesCopied: "Notes copiées",
    claimed: "Réclamé !",
    dev: "DEV",
    obSandboxTitle: "Bienvenue dans le bac à sable",
    obSandboxDesc: "Ceci est une démo en direct de notre escrow multisig 2-sur-3 — propulsé par Fedimint et Lightning. Essayez chaque rôle : créez des escrows, financez-les, votez et réclamez. Pas de vrais sats, aucun risque.",
    obRolesTitle: "Jouez chaque rôle",
    obRolesDesc: "Basculez entre Vendeur, Acheteur et Arbitre avec la barre de rôle en haut. Chaque rôle a une vue différente — comme dans un vrai échange. Parcourez un cycle complet en quelques minutes.",
    obCommunityTitle: "Prêt pour de vrais échanges ?",
    obCommunityDesc: "Quand vous êtes prêt à échanger de vrais sats, rejoignez notre communauté sur Fedi. Discutez avec des traders, apprenez les règles et lancez votre premier escrow — le tout dans la fédération.",
    sandboxBadge: "MODE BAC À SABLE",
    sandboxFooter: "Pas de vrais sats. Explorez librement.",
    tryDemo: "Essayer la démo",
    joinChat: "Rejoindre le chat communautaire",
    sandbox: "Bac à sable",
    playAs: "Jouer en tant que :",
  },

  es: {
    ob1Title: "Comercio P2P sin confianza",
    ob1Desc: "Intercambia cualquier cosa por bitcoin sin confiar en la otra parte. Tus sats quedan bloqueados en un fideicomiso federado de e-cash hasta que ambas partes acepten.",
    ob2Title: "3 Partes, Voto 2-de-3",
    ob2Desc: "Cada intercambio tiene un Vendedor, un Comprador y un Árbitro verificado elegido por la comunidad. Dos deben aceptar para liberar o reembolsar. Si comprador y vendedor están de acuerdo, el árbitro nunca es necesario.",
    ob3Title: "Pago Lightning instantáneo",
    ob3Desc: "Los sats se bloquean vía Lightning y se pagan al instante. Sin comisiones on-chain, sin esperas. Todo impulsado por tu federación Fedi.",
    obStartTrading: "Empezar a intercambiar",
    obNext: "Siguiente",
    obSkip: "Saltar",
    obFedLimit: "Límite de la federación: {limit} sats por intercambio",

    escrow: "Fideicomiso Federado",
    newTrade: "Nuevo intercambio",
    joinEscrow: "Unirse a un fideicomiso",
    maxPerTrade: "Máx {limit} sats por intercambio",
    noEscrows: "Sin fideicomisos aún. Crea uno nuevo o únete a uno existente.",
    sats: "sats",

    amountSats: "Monto (sats)",
    description: "Descripción",
    tradeTerms: "Términos del intercambio",
    communityLink: "Enlace de comunidad",
    communityLinkHint: "Pega el enlace de la sala Fedi donde se organizó este intercambio",
    createEscrow: "Crear fideicomiso",
    creating: "Creando…",
    maxFedLimit: "Máx {limit} sats por intercambio (límite de la federación)",
    howItWorks: "Cómo funciona",
    howStep1: "Tú creas el fideicomiso como",
    howStep1Role: "Vendedor",
    howStep2: "Comparte el ID en el chat. El Comprador y el Árbitro se unen.",
    howStep3: "Bloqueas los sats vía Lightning.",
    howStep4: "Completa el intercambio. Ambas partes votan para liberar.",
    howStep5: "El comprador reclama los sats al instante.",

    escrowId: "ID del fideicomiso",
    escrowIdPlaceholder: "Pega el ID del fideicomiso desde el chat",
    yourRole: "Tu rol",
    buyer: "Comprador",
    arbiter: "Árbitro",
    joinAs: "Unirse como {role}",
    joining: "Uniéndose…",
    buyerDesc: "Estás comprando algo del vendedor. Después del intercambio, votas para liberar los sats hacia ti.",
    arbiterDesc: "Un mediador comunitario de confianza. Los árbitros son miembros verificados que solo votan cuando comprador y vendedor no están de acuerdo.",
    arbiterRestricted: "Rol de árbitro restringido.",
    arbiterRestrictedDesc: "Solo miembros pre-aprobados pueden servir como árbitros. Contacta a un guardián de la federación para ser añadido.",

    trade: "Intercambio",
    escrowAmount: "Monto del fideicomiso",
    youAreThe: "Eres el/la",
    participants: "Participantes",
    seller: "Vendedor",
    waiting: "esperando…",
    votesLabel: "Votos",
    release: "Liberar",
    refund: "Reembolsar",
    resolved: "Resuelto",
    resolvedRelease: "Liberación → El comprador gana",
    resolvedRefund: "Reembolso → El vendedor reembolsado",
    tradeComplete: "Intercambio completado",
    satsDelivered: "{amount} sats entregados sin confianza",

    lockSats: "Bloquear {amount} sats en el fideicomiso",
    locking: "Bloqueando…",
    confirmRelease: "Confirmar intercambio — Liberar",
    voting: "Votando…",
    confirm: "Confirmar",
    dispute: "Disputar",
    claimSats: "Reclamar tus {amount} sats",
    claiming: "Reclamando…",
    confirmInFedi: "Confirma el pago en Fedi…",
    paymentCancelled: "Pago cancelado — toca de nuevo",
    satsLocked: "¡Sats bloqueados en el fideicomiso!",
    votedRelease: "Votó por la liberación",
    votedRefund: "Votó por el reembolso",
    sendingPayout: "Enviando pago…",
    satsReceived: "¡Sats recibidos!",
    invoiceCancelled: "Factura cancelada — toca de nuevo",

    waitSeller: "Esperando respuesta del vendedor…",
    waitBuyerVote: "Esperando el voto del comprador…",
    waitResolution: "Esperando resolución…",
    waitBothVote: "Esperando votos del comprador y vendedor…",
    noDispute: "Comprador y vendedor están de acuerdo — sin disputa",
    waitSellerLock: "Esperando que el vendedor bloquee los fondos…",
    waitParties: "Esperando a todos los participantes…",
    tradeCompleteBanner: "¡Intercambio completado — sats pagados!",

    statusCreated: "Esperando participantes",
    statusFunded: "Listo para bloquear",
    statusLocked: "Fondos bloqueados",
    statusApproved: "Resuelto",
    statusClaimed: "Reclamado",
    statusCompleted: "Completado",
    statusExpired: "Expirado",

    deliveredToBuyer: "Entregado al comprador",
    refundedToSeller: "Reembolsado al vendedor",
    readyToClaim: "Listo para reclamar",
    securedInVault: "Asegurado en la bóveda",
    readyToLock: "Listo para bloquear",
    escrowExpired: "Fideicomiso expirado",
    waitingAllParties: "Esperando a todos los participantes",

    copied: "{label} copiado",
    copyFailed: "Error al copiar",
    connectingNostr: "Conectando con identidad Nostr…",
    failedLoadEscrows: "Error al cargar",
    escrowCreated: "¡Fideicomiso creado!",
    joinedAs: "¡Unido como {role}!",
    lockedDevMode: "Bloqueado (modo dev)",
    notesCopied: "Notas copiadas",
    claimed: "¡Reclamado!",
    dev: "DEV",
  },
};

// ── Locale management ────────────────────────────────────────────────

const LOCALE_KEY = "fedi-escrow-locale";

let _locale = (() => {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && translations[stored]) return stored;
  } catch {}
  // Auto-detect from browser
  const nav = (typeof navigator !== "undefined" && navigator.language) || "en";
  const lang = nav.split("-")[0].toLowerCase();
  return translations[lang] ? lang : "en";
})();

export function getLocale() { return _locale; }

export function setLocale(locale) {
  if (!translations[locale]) return;
  _locale = locale;
  try { localStorage.setItem(LOCALE_KEY, locale); } catch {}
}

export function getAvailableLocales() {
  return [
    { code: "en", label: "English", flag: "🇺🇸" },
    { code: "fr", label: "Français", flag: "🇫🇷" },
    { code: "es", label: "Español", flag: "🇪🇸" },
  ];
}

/**
 * Translate a key with optional interpolation.
 * t("lockSats", { amount: "25,000" }) → "Lock 25,000 sats into escrow"
 */
export function t(key, vars = {}) {
  const str = translations[_locale]?.[key] || translations.en?.[key] || key;
  if (!vars || Object.keys(vars).length === 0) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
}

export default translations;
