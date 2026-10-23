# Horizon Blanc 403

Application de gestion de la location saisonnière Horizon Blanc 403 (La Joue du Loup, Le Dévoluy).

Elle est publiée comme artifact claude.ai : les données sont stockées dans la base de l'artifact (capability `db`), Claude répond depuis l'onglet Compta (capability `sample`) et les exports passent par la capability `downloads`. Aucune donnée personnelle n'est écrite dans ce dépôt.

## Onglets

- **Planning** : séjour en cours, calendrier mensuel par canal, réservations (prix hôte, commission, taxe de séjour, conciergerie, caution).
- **Compta** : résultat avant amortissements, dépenses par compte du plan comptable, factures détectées dans les mails à valider, assistant Claude (questions et photo de facture), export des écritures au format du journal du classeur Excel (ventes, achats, PCA).
- **To do** : décisions à trancher, actions, check-lists d'arrivée et de départ.
- **Discussions** : voyageurs et prestataires, raccourcis vers les messageries des plateformes, mails clients, messages modèles.
- **Plus** : Juridique (fiche du bien, documents, échéances), Conciergerie, Taxe de séjour, Banque (import CSV, rapprochement, échéancier d'emprunt), Tarification (grille, historique, veille, propositions de Claude), Réglages (boîtes mail liées, taux, tarifs, sauvegarde).

## Structure

```
index.html            page (contenu publié tel quel dans l'artifact)
js/app.js             navigation et rendu
js/store.js           données, synchronisation avec la base, calculs métier
js/compta.js          génération des écritures
js/ui.js              feuilles modales, confirmations, téléchargements
js/utils.js           dates, montants
js/views/*.js         un fichier par onglet ; forms.js pour les formulaires partagés
```

Hors de claude.ai (aperçu local), l'appli bascule sur le `localStorage` du navigateur.

## Tâche quotidienne

Une tâche planifiée Claude (7 h 36, heure de Paris) lit les boîtes mail marquées « Liée » dans Réglages, écrit les factures à valider dans `inbox`, crée les décisions dans `tasks`, archive les mails traités sous le libellé `HB403` et, le lundi, met à jour la veille marché (`config/market`).

## Lanceur (icône sur le téléphone)

Le dossier `docs/` contient une petite appli installable (PWA) avec l'icône « HB 403 ». Lancée depuis l'écran d'accueil, elle ouvre l'appli sur claude.ai. Pour la mettre en ligne : GitHub › Settings › Pages › Source « Deploy from a branch », branche `claude/app-horizon-blanc`, dossier `/docs`. GitHub Pages sur un dépôt privé demande un abonnement GitHub payant ; sinon, rendre le dépôt public (il ne contient aucune donnée personnelle).
