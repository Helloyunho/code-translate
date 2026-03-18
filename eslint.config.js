import neostandard from 'neostandard'

export default neostandard({
  ts: true,
  env: ['browser'],
  files: ['public/**/*.js'],
  filesTs: ['src/**/*.ts'],
  ignores: ['node_modules', '.wrangler']
})
