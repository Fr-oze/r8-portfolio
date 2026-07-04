// Projets repris du portfolio Horizon (site scribble), réécrits pour la DA
// data/wireframe de ce site. image = capture (ou null → placeholder wireframe).
// detail = contenu complet affiché au clic (pourquoi / comment / ce qui a été fait).
export interface ProjectDetail {
  role: string;
  problem: string;
  solution: string;
  /** [titre, description, mis en avant?] */
  features: [string, string, boolean?][];
  result: string;
  /** [légende, chemin image, "wide" = pleine largeur (écran horizontal)] */
  gallery: [string, string, ("wide")?][];
}

export interface Project {
  id: string;
  name: string;
  kind: string;
  year: string;
  brand: { logo: string; accent: string };
  text: string;
  tags: string[];
  url: string | null;
  image: string | null;
  detail: ProjectDetail;
}

export const PROJECTS: Project[] = [
  {
    id: "vkstudio",
    name: "VK STUDIO",
    kind: "GROWTH PARTNER · E-LEARNING",
    year: "2024-26",
    brand: { logo: "/brand/vkstudio-white.png", accent: "#7c83ff" },
    text: "Partenaire de croissance : refonte du site et du tunnel de vente, achat média, tracking serveur, et reconstruction complète de la plateforme de cours Polaris.",
    tags: ["NEXT.JS", "FUNNEL", "PLATFORM", "MEDIA BUYING"],
    url: "vkstudio.fr",
    image: "/projects/vkstudio/landing.png",
    detail: {
      role: "CROISSANCE & PRODUIT · DE LA PUB À LA PLATEFORME",
      problem:
        "VK Studio forme des monteurs vidéo. Le produit existait ; ce qui manquait, c'était la machine qui fait venir des élèves, les convertit et les garde, plus une plateforme de cours solide. Tout ce qui transforme une formation en vraie boîte.",
      solution:
        "On gère la croissance de bout en bout : refonte du site et du tunnel de vente, achat de pub, tracking précis, et reconstruction complète de la plateforme Polaris.",
      features: [
        ["LE SITE & LE TUNNEL DE VENTE", "Refonte de vkstudio.fr : pages de vente, blog SEO (29 articles), pages Polaris. Un tunnel quiz → opt-in → réservation branché sur iClosed, avec une URL par canal pour savoir d'où vient chaque vente."],
        ["LE TRACKING", "Pixel Meta côté serveur (CAPI) + GA4 + un dashboard maison : revenu, taux de show et de closing par canal. On voit où va chaque euro de pub."],
        ["LA PLATEFORME POLARIS", "Reconstruction from scratch de intra.vkstudio.fr : galaxie 3D de 4 planètes (Premiere, DaVinci, Claude IA, Freelance), 73 modules, progression par niveaux, vidéos et QCM."],
        ["LE MEDIA BUYING", "Pubs Meta réglées chaque jour, profils ciblés par le quiz. On garde ce qui ramène des élèves au bon prix."],
        ["LES OUTILS INTERNES", "Bots Discord (suivi des ventes, support), dashboard RH de l'équipe, suivi des paiements prestataires. La boîte tourne sur nos outils."],
        ["LE PILOTAGE", "Pouvoir de décision réel sur le produit et l'organisation. Quand ça bloque, on tranche, pas de simple conseil."],
      ],
      result:
        "2,6 M€ de CA en 2025, 4 088 membres actifs, et un webinaire lancé qui a généré plus de 500 k€.",
      gallery: [
        ["LA HOME EN 3D", "/projects/vkstudio/landing.png"],
        ["LES TUNNELS DE VENTE", "/projects/vkstudio/tracking.png"],
        ["LA GALAXIE DES PARCOURS", "/projects/vkstudio/polaris-galaxy.png"],
        ["LES NIVEAUX D'UNE PLANÈTE", "/projects/vkstudio/polaris-levels.png"],
        ["L'ACCUEIL DE L'ÉLÈVE", "/projects/vkstudio/accueil.png"],
        ["LE CRM ÉLÈVE", "/projects/vkstudio/crm.png"],
        ["LE PORTFOLIO PUBLIC", "/projects/vkstudio/portfolio.png"],
        ["LE SUIVI DE PROGRESSION", "/projects/vkstudio/profil.png"],
      ],
    },
  },
  {
    id: "vkstudio-polaris",
    name: "VK STUDIO · POLARIS",
    kind: "PLATEFORME DE FORMATION",
    year: "2025",
    brand: { logo: "/brand/vkstudio-white.png", accent: "#7c83ff" },
    text: "Une galaxie de planètes à explorer, des niveaux à débloquer, de la progression gamifiée. Plus les outils pour passer pro : CRM élève et portfolio public.",
    tags: ["3D", "GAMIFICATION", "LMS"],
    url: null,
    image: "/projects/vkstudio/polaris-galaxy.png",
    detail: {
      role: "PRODUIT · PLATEFORME DE DELIVERY ÉLÈVE",
      problem:
        "Une formation, ça se regarde souvent par obligation. Le risque : l'élève ouvre la plateforme une fois, se perd dans une liste de vidéos, et ne revient pas. Sans engagement, pas de résultats, et donc pas de bouche-à-oreille.",
      solution:
        "Reconstruction complète de la plateforme avec une logique de jeu : on a envie d'ouvrir Polaris, pas de la subir. Une galaxie de planètes, des niveaux à débloquer, de la progression visible, plus les outils concrets pour passer pro.",
      features: [
        ["LA GALAXIE DES PARCOURS", "4 planètes (Premiere, DaVinci, Claude IA, Freelance) en 3D, chacune un parcours. On voit son chemin et ce qu'il reste à explorer.", true],
        ["LES NIVEAUX & LA PROGRESSION", "73 modules répartis en niveaux à débloquer. Vidéos + QCM, progression sauvegardée, sentiment d'avancer à chaque session."],
        ["LE CRM ÉLÈVE", "Un outil pour gérer ses prospects et ses missions une fois lancé en freelance : la formation débouche sur du concret."],
        ["LE PORTFOLIO PUBLIC", "Chaque élève se construit un portfolio public pour décrocher ses premiers clients."],
      ],
      result:
        "Une plateforme qu'on ouvre par envie : plus d'engagement, plus de complétion, et des élèves qui passent vraiment pro.",
      gallery: [
        ["LA GALAXIE DES PARCOURS", "/projects/vkstudio/polaris-galaxy.png"],
        ["LES NIVEAUX D'UNE PLANÈTE", "/projects/vkstudio/polaris-levels.png"],
        ["L'ACCUEIL DE L'ÉLÈVE", "/projects/vkstudio/accueil.png"],
        ["LE SUIVI DE PROGRESSION", "/projects/vkstudio/profil.png"],
        ["LE CRM ÉLÈVE", "/projects/vkstudio/crm.png"],
        ["LE PORTFOLIO PUBLIC", "/projects/vkstudio/portfolio.png"],
      ],
    },
  },
  {
    id: "vkstudio-tracking",
    name: "VK STUDIO · TRACKING",
    kind: "DASHBOARD SUR MESURE",
    year: "2025",
    brand: { logo: "/brand/vkstudio-white.png", accent: "#7c83ff" },
    text: "Un dashboard maison pour voir ce qui convertit vraiment : quelle technique, quelle vidéo, quel canal ramènent le plus de ventes. On pilote la pub avec des chiffres.",
    tags: ["CAPI", "GA4", "ANALYTICS"],
    url: null,
    image: "/projects/vkstudio/tracking.png",
    detail: {
      role: "DATA · PILOTAGE DE LA CROISSANCE",
      problem:
        "Quand on dépense en pub, le pire c'est de naviguer à l'aveugle : on ne sait pas quelle vidéo, quel angle ou quel canal ramène vraiment des ventes. On optimise au feeling et on brûle du budget.",
      solution:
        "Un système de tracking serveur + un dashboard maison qui relie chaque euro dépensé à chaque vente. On décide avec des chiffres, pas avec des impressions.",
      features: [
        ["LE TRACKING SERVEUR (CAPI)", "Pixel Meta côté serveur + GA4 : on capte les conversions même quand le navigateur bloque, pour des données fiables.", true],
        ["UNE URL PAR CANAL", "Chaque source (pub, organique, partenaire) a son URL. On sait d'où vient chaque réservation et chaque vente."],
        ["LE DASHBOARD MAISON", "Revenu, taux de show, taux de closing par canal et par angle. Une lecture claire de ce qui marche."],
      ],
      result:
        "On pilote l'achat média avec des données réelles : on coupe ce qui ne convertit pas, on pousse ce qui ramène des élèves au bon prix.",
      gallery: [
        ["LES TUNNELS DE VENTE", "/projects/vkstudio/tracking.png"],
      ],
    },
  },
  {
    id: "schema-chantierpilot",
    name: "SCHEMA · CHANTIERPILOT",
    kind: "LOGICIEL DE GESTION · BTP",
    year: "2025-26",
    brand: { logo: "/brand/schema-mark.svg", accent: "#40916C" },
    text: "Le logiciel de gestion de chantiers pour les PME du bâtiment. Le patron voit tous ses chantiers, son planning et ses marges au même endroit, en temps réel.",
    tags: ["BTP", "GESTION", "PLANNING"],
    url: null,
    image: "/projects/schema/chantierpilot_chantiers.png",
    detail: {
      role: "CONÇU ET DÉVELOPPÉ PAR HORIZON",
      problem:
        "Sur un chantier, tout part dans tous les sens : qui fait quoi, l'avancement, les coûts. Beaucoup de PME du bâtiment gèrent ça sur papier ou sur Excel. On perd des heures, et on ne sait pas si un chantier rapporte avant qu'il soit fini.",
      solution:
        "Un logiciel de gestion fait sur mesure pour le BTP. Le patron pilote tous ses chantiers depuis un seul écran, sans être informaticien.",
      features: [
        ["LE GESTIONNAIRE DE CHANTIERS", "Le cœur du système. Chaque chantier, ses tâches, son avancement et son coût d'un coup d'œil. Tout le monde regarde la même info.", true],
        ["LE PLANNING DES ÉQUIPES", "Qui est sur quel chantier, quel jour. On répartit les équipes en un glisser-déposer et on évite les trous comme les doublons."],
        ["LE SUIVI FINANCIER", "Devis, dépenses et marge par chantier. On voit en direct si un chantier gagne ou perd de l'argent."],
      ],
      result:
        "Le patron sait où en sont ses chantiers et ce qu'ils coûtent en temps réel, au lieu de le découvrir trop tard.",
      gallery: [
        ["LE GESTIONNAIRE DE CHANTIERS", "/projects/schema/chantierpilot_chantiers.png", "wide"],
        ["LE PLANNING DES ÉQUIPES", "/projects/schema/chantierpilot_planning.png"],
        ["LE SUIVI FINANCIER", "/projects/schema/chantierpilot_finances.png"],
      ],
    },
  },
  {
    id: "schema-pointeuse",
    name: "SCHEMA · POINTEUSE",
    kind: "POINTAGE & PAIE · BTP",
    year: "2025-26",
    brand: { logo: "/brand/schema-mark.svg", accent: "#40916C" },
    text: "La pointeuse mobile géolocalisée pour les équipes de chantier. Les heures remontent directement côté patron, prêtes pour la paie, sans ressaisie.",
    tags: ["BTP", "POINTEUSE", "PAIE"],
    url: null,
    image: "/projects/schema/toituresmartin_pointage.png",
    detail: {
      role: "CONÇU ET DÉVELOPPÉ PAR HORIZON",
      problem:
        "Suivre les heures des équipes sur le terrain, c'est la galère : qui a bossé, sur quel chantier, combien de temps. Tout finit en feuilles d'heures à ressaisir, avec des erreurs et des justificatifs d'indemnités (météo, trajets) qui se perdent.",
      solution:
        "Une pointeuse mobile géolocalisée que les équipes utilisent depuis leur téléphone, et une remontée automatique des heures côté patron, directement exploitable pour la paie.",
      features: [
        ["LE POINTAGE EN UN GESTE", "L'ouvrier choisit son profil et pointe son arrivée/départ depuis son téléphone, géolocalisé sur le bon chantier. Zéro feuille d'heures.", true],
        ["LA POINTEUSE MOBILE", "Pensée pour le terrain : simple, rapide, utilisable avec des gants. On sait qui a bossé, où et combien de temps, en temps réel."],
        ["LA PAIE CÔTÉ PATRON", "Les heures pointées remontent directement côté patron : préparation de la paie et justificatifs d'indemnités (météo, trajets) sans ressaisie."],
      ],
      result:
        "Plus de ressaisie ni d'à-peu-près : des heures fiables, géolocalisées, et une paie préparée à partir de données réelles.",
      gallery: [
        ["LE POINTAGE : CHOIX DU PROFIL", "/projects/schema/toituresmartin_profil.png"],
        ["LA POINTEUSE MOBILE", "/projects/schema/toituresmartin_pointage.png"],
        ["LA PAIE CÔTÉ PATRON", "/projects/schema/toituresmartin_paie.png", "wide"],
      ],
    },
  },
  {
    id: "frame-exe",
    name: "FRAME.EXE",
    kind: "OUTIL DE PRODUCTION · YOUTUBE",
    year: "2026",
    brand: { logo: "/brand/frame-exe-mark.svg", accent: "#00ff41" },
    text: "L'outil de prod sur mesure d'une boîte de production YouTube. La pipeline qui dit où en est chaque vidéo, plus un éditeur de scripts guidé et des schémas de trame.",
    tags: ["YOUTUBE", "PRODUCTION", "PIPELINE", "SCRIPT"],
    url: null,
    image: "/projects/frame-exe/dashboard.png",
    detail: {
      role: "CONÇU ET DÉVELOPPÉ PAR HORIZON",
      problem:
        "Quand une boîte sort des vidéos YouTube en série, le vrai problème c'est de ne jamais savoir où on en est. Une vidéo est-elle en écriture, au tournage, au montage, prête à publier ? L'info est éclatée entre des Google Docs, des messages et la tête de chacun. On découvre les retards trop tard et personne n'a la vue d'ensemble.",
      solution:
        "Un outil unique qui rend l'avancement lisible d'un coup d'œil : une pipeline où chaque vidéo a un état clair, une timeline avec les deadlines, et tout le travail d'écriture au même endroit (scripts guidés + schémas de trame).",
      features: [
        ["LA PIPELINE DE PRODUCTION", "Le cœur de l'outil. Chaque vidéo avance dans des états nets : idée, écriture, tournage, montage, fini, publié. Toute l'équipe voit en un coup d'œil où en est chaque production et ce qui coince.", true],
        ["LA TIMELINE & LES DEADLINES", "Une vue planning de toutes les vidéos : ce qui est publié, en cours, en retard, et ce qui n'a pas encore de date. On anticipe les trous de calendrier au lieu de les subir."],
        ["L'ÉDITEUR DE SCRIPTS", "Mieux pensé que Google Docs pour l'écriture vidéo : structure dédiée, guides d'écriture intégrés, et un suivi de la « dette narrative » qui repère quand le récit décroche avant même le tournage."],
        ["LES SCHÉMAS DE TRAME", "Un Excalidraw intégré pour dessiner la trame d'une vidéo : courbe de tension, arcs, rebonds. On visualise le récit en schéma à côté du script."],
        ["LES NOTIFS & LE TRAVAIL D'ÉQUIPE", "Monteurs, rédacteurs et responsables sur le même outil. Retours, validations et changements d'état remontent en notifications : on sait quand une vidéo passe à l'étape suivante."],
      ],
      result:
        "Fini le « elle en est où la vidéo ? ». Toute l'équipe a la même vue sur l'avancement, du brainstorm à la mise en ligne, et les retards se voient avant qu'il soit trop tard.",
      gallery: [
        ["LE DASHBOARD : TOUS LES PROJETS PAR ÉTAT", "/projects/frame-exe/dashboard.png", "wide"],
        ["LA TIMELINE : DEADLINES ET AVANCEMENT", "/projects/frame-exe/timeline.png", "wide"],
        ["UN PROJET : PIPELINE, SCRIPT ET TRAME", "/projects/frame-exe/projet.png", "wide"],
        ["LES NOTIFS : RETOURS ET VALIDATIONS", "/projects/frame-exe/notifs.png", "wide"],
      ],
    },
  },
  {
    id: "pulseod",
    name: "PULSEOD",
    kind: "REPORTING SALES · ANALYSE IA",
    year: "2026",
    brand: { logo: "/brand/pulseod-mark.svg", accent: "#2563eb" },
    text: "Le poste de pilotage des équipes commerciales. Chaque closer remplit son rapport de fin de journée en deux minutes, le manager voit la perf en temps réel, et une IA transforme les commentaires en actions.",
    tags: ["SALES", "REPORTING", "IA", "DASHBOARD"],
    url: null,
    image: "/projects/pulseod/dashboard.png",
    detail: {
      role: "CONÇU ET DÉVELOPPÉ PAR HORIZON",
      problem:
        "Une équipe commerciale (closers, setters) génère une tonne d'activité chaque jour, mais le manager n'a aucune lecture claire de ce qui se passe vraiment. Les rapports de fin de journée sont éparpillés entre Discord, messages et tableurs, les remontées terrain sur la qualité des leads se perdent, et les problèmes (no-show, leads pourris) se voient trop tard.",
      solution:
        "Un SaaS pensé comme une war room pour les sales : chaque commercial remplit son rapport de fin de journée en deux minutes, le dashboard affiche la perf de l'équipe en temps réel, et une IA lit tous les commentaires pour faire remonter les problèmes récurrents et des actions concrètes.",
      features: [
        ["LE RAPPORT DE FIN DE JOURNÉE (EOD)", "Chaque closer ou setter saisit ses chiffres du jour en deux minutes : appels planifiés et réalisés, ventes, no-show, annulations, plus un champ libre sur la qualité des leads.", true],
        ["LE DASHBOARD TEMPS RÉEL", "Toute la perf de l'équipe d'un coup d'œil : appels, ventes, taux de conversion, CA généré, no-show. Filtres par jour, semaine, mois. Le manager sait où en est l'équipe sans relancer personne."],
        ["L'ANALYSE IA DES COMMENTAIRES", "Une IA lit tous les commentaires de l'équipe, repère les problèmes récurrents (leads Ads de mauvaise qualité, no-show en hausse) et sort une note quotidienne avec des recommandations actionnables, pas juste des constats.", true],
        ["LE LEADERBOARD", "Classement des commerciaux par performance sur la période. L'équipe se tire vers le haut, le manager repère vite qui décroche et qui performe."],
        ["MULTI-ÉQUIPES & RÔLES", "Architecture multi-tenant : le CEO crée son équipe, invite ses membres et attribue les rôles (CEO, sales manager, closer, setter). Chaque équipe a ses données isolées."],
      ],
      result:
        "Le manager a enfin une lecture quotidienne et fiable de sa force de vente : les problèmes terrain remontent avec des actions concrètes au lieu de se perdre, et l'équipe se pilote avec des chiffres.",
      gallery: [
        ["LE DASHBOARD : APPELS, VENTES & ENTONNOIR", "/projects/pulseod/dashboard.png", "wide"],
        ["LES STATS DÉTAILLÉES : TAUX DE CONVERSION", "/projects/pulseod/stats.png", "wide"],
        ["LE LEADERBOARD : PERF PAR CLOSER", "/projects/pulseod/leaderboard.png", "wide"],
      ],
    },
  },
];
