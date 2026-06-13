# Bolao dos Follis

Site estatico para acompanhar o Bolao dos Follis na Copa do Mundo 2026.

## Fluxo de atualizacao

1. Exporte o CSV do Google Forms.
2. Substitua `data/raw/group-stage-current.csv`.
3. Ajuste nomes em `data/manual/people.json`, se alguem preencher diferente.
4. Atualize resultados em `data/manual/tournament.json`.
5. Rode:

```bash
npm test
npm run build
```

6. Confira o site local:

```bash
npm run dev
```

Abra `http://localhost:4173`.

## Dados

- `data/raw/`: CSVs brutos locais, ignorados pelo Git.
- `data/manual/`: configuracoes editaveis, nomes, aliases e resultados.
- `site/data/site-data.json`: JSON limpo publicado no site.

## Publicacao

O workflow em `.github/workflows/pages.yml` publica apenas a pasta `site/` no GitHub Pages.
