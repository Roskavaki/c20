import fs from "fs";
import express from "express";
import buildConfig from "../build-config.json";
// SPOOPY BUG: do not reorder the next two lines!!!!!
import renderPage from "./lib/render/render";
import {getPageBaseDir, getPageMdSrcPath, loadPageIndex} from "./lib/content";
import {loadYamlTree} from "./lib/utils/files";
import {type BuildOpts} from "./build";
import {parse} from "./lib/components/Md/markdown";
import { buildSearchIndex, SearchDoc } from "./lib/search";
import { buildRedirects } from "./lib/redirects";
const loadStructuredData = require("./data");

const buildOpts: BuildOpts = {
  baseUrl: buildConfig.baseUrl,
  contentDir: buildConfig.paths.srcContentBase,
  outputDir: buildConfig.paths.dist,
  noThumbs: !!process.env.C20_NO_THUMBNAILS,
};

const reqs: any[] = [];

export default function runServer(onDemand: boolean) {
  const port = process.env.C20_PORT ? Number(process.env.C20_PORT) : 8080;
  const app = express();

  // Serve everything in the output dir, except index.html when in onDemand mode
  app.use(express.static(buildOpts.outputDir, {index: onDemand ? false : ["index.html"]}));

  if (onDemand) {
    app.use(express.static(buildOpts.contentDir));
    app.get("/assets/search-index_:lang(\\w{2}).json", async (req, res, next) => {
      const lang = req.params.lang.toLowerCase();
      console.log(`Building search index: ${lang}`);
      const pageIndex = await loadPageIndex(buildOpts.contentDir);
      const searchDocs: SearchDoc[] = Object.entries(pageIndex).map(([pageId, pageDataByLang]): SearchDoc => {
        const pageData = pageDataByLang[lang];
        return {
          lang,
          path: pageId,
          keywords: pageData.front.keywords?.join(" ") ?? "",
          title: pageData.front.title ?? "",
          text: "", //render plaintext? or keep it fast during dev?
        };
      });
      const json = buildSearchIndex(searchDocs)[lang];
      res.header("Content-Type", "application/json; charset=UTF-8");
      res.send(json);
    });
    app.get("/:page([-/_a-zA-Z0-9]+)?", async (req, res, next) => {
      // const lang = req.params.lang?.toLowerCase() ?? "en";
      const lang = "en";
      const pageId = req.params.page ?
        `/${req.params.page.endsWith("/") ? req.params.page.replace(/\/+$/, "") : req.params.page}` :
        "/";
      
      console.log(`Rendering ${pageId}`);
      const baseDir = getPageBaseDir(pageId, buildOpts);
      const mdSrcPath = getPageMdSrcPath(baseDir, lang);

      const dataPromise = loadStructuredData();
      const localDataPromise = loadYamlTree(baseDir, {nonRecursive: true});
      const pageIndexPromise = loadPageIndex(buildOpts.contentDir);
      const mdSrcPromise = fs.promises.readFile(mdSrcPath, "utf-8");

      let mdSrc
      try {
        mdSrc = await mdSrcPromise;
      } catch (err) {
        next();
        return;
      }  
      
      const {ast, frontmatter} = parse(mdSrc, mdSrcPath);

      const renderOutput = renderPage({
        baseUrl: buildOpts.baseUrl,
        noThumbs: true,
        preloadSearch: false,
        debug: !!process.env.C20_DEBUG || req.query.debug,
        pageId,
        lang,
        ast,
        front: frontmatter,
        localData: await localDataPromise,
        globalData: await dataPromise,
        pageIndex: await pageIndexPromise,
      });
    
      res.header("Content-Type", "text/html; charset=UTF-8");
      res.send(renderOutput.htmlDoc);
    });
  }

  app.get("/:page([-/_a-zA-Z0-9]+)?", async (req, res, next) => {
    const pageIndex = await loadPageIndex(buildOpts.contentDir);
    const redirects = buildRedirects(pageIndex);
    const pageId = req.params.page ?
      `/${req.params.page.endsWith("/") ? req.params.page.replace(/\/+$/, "") : req.params.page}` :
      "/";
    const redirect = redirects[pageId];
    if (redirect) {
      console.log(`Using redirect from '${pageId}' to ${redirect}`);
      res.redirect(redirect);
    } else {
      next();
    }
  });

  // Fall through to 404 handler
  app.use((req, res) => {
    console.warn(`Unable to handle URL ${req.url}, returning 404!`);
	  res.status(404);
	  res.header("Content-Type", "text/plain; charset=UTF-8");
	  res.send("Page or file not found!");
  });

  app.listen(port);
  console.log(`Serving at http://localhost:${port}/. Press Ctrl+C to stop.`);
};
