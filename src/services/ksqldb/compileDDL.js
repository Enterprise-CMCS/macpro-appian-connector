var fs = require("fs");
var path = require("path");

var walkTree = function (dir, results = []) {
  const list = fs.readdirSync(dir);

  if (list.includes("manifest.js")) {
    const manifest = require(`${dir}/manifest`).manifest;
    list.sort((a, b) => manifest.indexOf(a) - manifest.indexOf(b));
  } else {
    list.sort();
  }

  list.forEach(function (file) {
    if (file === "manifest.js") return;
    const fileWPath = path.resolve(dir, file);
    const stat = fs.statSync(fileWPath);
    if (stat && stat.isDirectory()) {
      results = walkTree(fileWPath, results);
    } else {
      if (file.split(".").pop().toLowerCase() === "sql") {
        results.push(fileWPath);
      }
    }
  });

  return results;
};

const compileDDL = function (dry = false) {
  const tree = walkTree("./ddl");

  if (dry) {
    console.log(tree);
    return tree;
  }

  var results = "";
  for (const file of tree) {
    const contents = fs.readFileSync(file, "utf8");
    results += contents + "\n";
  }

  return results;
};

compileDDL(true);
module.exports.ddl = compileDDL();
