import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const login = process.env.PROFILE_LOGIN || process.env.GITHUB_REPOSITORY_OWNER || 'Vincent-Eclipse'
const token = process.env.GITHUB_TOKEN

if (!token) {
  throw new Error('GITHUB_TOKEN is required')
}

const now = new Date()
const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

const query = `
  query ProfileData($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      repositories(first: 100, privacy: PUBLIC, ownerAffiliations: OWNER, isFork: false) {
        totalCount
        nodes {
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
        }
        totalCommitContributions
        totalPullRequestContributions
      }
    }
  }
`

const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'cenvalo-profile-card'
  },
  body: JSON.stringify({
    query,
    variables: {
      login,
      from: from.toISOString(),
      to: now.toISOString()
    }
  })
})

if (!response.ok) {
  throw new Error(`GitHub API request failed with status ${response.status}`)
}

const payload = await response.json()

if (payload.errors || !payload.data?.user) {
  throw new Error('GitHub GraphQL response did not contain the expected profile data')
}

const { contributionsCollection, repositories } = payload.data.user
const languageTotals = new Map()

for (const repository of repositories.nodes) {
  for (const edge of repository.languages.edges) {
    const current = languageTotals.get(edge.node.name) || {
      color: edge.node.color || '#168bff',
      size: 0
    }

    current.size += edge.size
    languageTotals.set(edge.node.name, current)
  }
}

const languages = [...languageTotals]
  .map(([name, value]) => ({ name, ...value }))
  .sort((left, right) => right.size - left.size)

const totalLanguageSize = languages.reduce((sum, language) => sum + language.size, 0)
const topLanguages = languages.slice(0, 5).map(language => ({
  ...language,
  percentage: totalLanguageSize === 0 ? 0 : (language.size / totalLanguageSize) * 100
}))

const metrics = [
  ['Contributions', contributionsCollection.contributionCalendar.totalContributions],
  ['Commits', contributionsCollection.totalCommitContributions],
  ['Pull requests', contributionsCollection.totalPullRequestContributions],
  ['Public repos', repositories.totalCount]
]

const escapeXml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

const metricWidth = 186
const metricGap = 18
const metricCards = metrics.map(([label, value], index) => {
  const x = 42 + index * (metricWidth + metricGap)

  return `<g transform="translate(${x} 104)">
      <rect width="${metricWidth}" height="82" rx="8" fill="#111722" stroke="#273244"/>
      <text x="16" y="31" class="metric-value">${escapeXml(value)}</text>
      <text x="16" y="59" class="metric-label">${escapeXml(label)}</text>
    </g>`
}).join('\n')

let barOffset = 0
const barWidth = 816
const languageBars = topLanguages.map(language => {
  const width = totalLanguageSize === 0 ? 0 : barWidth * language.size / totalLanguageSize
  const segment = `<rect x="${(42 + barOffset).toFixed(2)}" y="234" width="${Math.max(width, 1).toFixed(2)}" height="10" fill="${escapeXml(language.color)}"/>`
  barOffset += width
  return segment
}).join('')

const languageLegend = topLanguages.map((language, index) => {
  const x = 42 + index * 162
  const roundedPercentage = Math.round(language.percentage)
  const percentage = language.percentage > 0 && roundedPercentage === 0
    ? '&lt;1'
    : String(roundedPercentage)
  const shortName = language.name.length > 13 ? `${language.name.slice(0, 12)}…` : language.name

  return `<g transform="translate(${x} 274)">
      <circle cx="5" cy="-4" r="5" fill="${escapeXml(language.color)}"/>
      <text x="17" y="0" class="language">${escapeXml(shortName)} ${percentage}%</text>
    </g>`
}).join('\n')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="330" viewBox="0 0 900 330" role="img" aria-labelledby="title description">
  <title id="title">Development activity for ${escapeXml(login)}</title>
  <desc id="description">Rolling 30-day GitHub contribution metrics and language distribution across public owned repositories.</desc>
  <style>
    .eyebrow { fill: #4aa8ff; font: 600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 2px; }
    .heading { fill: #f4f7fb; font: 600 24px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .caption { fill: #738093; font: 400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .metric-value { fill: #f4f7fb; font: 600 25px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .metric-label { fill: #a7b2c2; font: 400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .section { fill: #a7b2c2; font: 600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 1px; }
    .language { fill: #a7b2c2; font: 400 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  </style>
  <rect x="1" y="1" width="898" height="328" rx="12" fill="#0b0e13" stroke="#273244" stroke-width="2"/>
  <path d="M1 78H899" stroke="#172233"/>
  <rect x="42" y="32" width="3" height="28" rx="1.5" fill="#168bff"/>
  <text x="60" y="38" class="eyebrow">DEVELOPMENT</text>
  <text x="60" y="62" class="heading">Last 30 days</text>
  <text x="858" y="51" text-anchor="end" class="caption">GitHub activity</text>
${metricCards}
  <text x="42" y="218" class="section">PUBLIC REPOSITORY LANGUAGES</text>
  <rect x="42" y="234" width="816" height="10" rx="5" fill="#172233"/>
  <clipPath id="language-bar"><rect x="42" y="234" width="816" height="10" rx="5"/></clipPath>
  <g clip-path="url(#language-bar)">${languageBars}</g>
${languageLegend}
  <text x="42" y="310" class="caption">Contribution totals may include private activity in aggregate; private project details are never exposed.</text>
</svg>
`

const outputDirectory = path.resolve('generated')
await mkdir(outputDirectory, { recursive: true })
await writeFile(path.join(outputDirectory, 'development.svg'), svg, 'utf8')
