import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { assert } from './util.js';

export class Store {
  constructor(root = process.env.F1_JEV_DATA_DIR || join(homedir(), '.codex', 'f1-jev-simulation')) {
    this.root = resolve(root);
  }
  async initialize() {
    await mkdir(join(this.root, 'seasons'), { recursive: true });
    await mkdir(join(this.root, 'runs'), { recursive: true });
    await mkdir(join(this.root, 'predictions'), { recursive: true });
  }
  seasonPath(year) { return join(this.root, 'seasons', `${year}.json`); }
  async getSeason(year) {
    try { return JSON.parse(await readFile(this.seasonPath(year), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async putSeason(year, races) {
    await this.initialize();
    await writeFile(this.seasonPath(year), JSON.stringify({ schemaVersion: 1, year, collectedAt: new Date().toISOString(), races }, null, 2), 'utf8');
  }
  async putRun(comparison) {
    await this.initialize();
    assert(/^comparison-[a-f0-9]+$/.test(comparison.id), 'Invalid comparison id.');
    const path = join(this.root, 'runs', `${comparison.id}.json`);
    await writeFile(path, JSON.stringify(comparison, null, 2), 'utf8');
    return path;
  }
  async listRuns() {
    await this.initialize();
    const files = (await readdir(join(this.root, 'runs'))).filter(name => /^comparison-[a-f0-9]+\.json$/.test(name));
    return Promise.all(files.map(async name => JSON.parse(await readFile(join(this.root, 'runs', name), 'utf8'))));
  }
  predictionPath(key) {
    assert(/^[a-f0-9]{32}$/.test(key), 'Invalid prediction cache key.');
    return join(this.root, 'predictions', `${key}.json`);
  }
  async getPrediction(key) {
    try { return JSON.parse(await readFile(this.predictionPath(key), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async putPrediction(key, prediction) {
    await this.initialize();
    await writeFile(this.predictionPath(key), JSON.stringify(prediction), 'utf8');
  }
  async putDashboard(html) {
    await this.initialize();
    const path = join(this.root, 'dashboard.html');
    await writeFile(path, html, 'utf8');
    return path;
  }
}
