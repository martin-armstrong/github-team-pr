// ==UserScript==
// @name         PR-List-team-gg
// @namespace    http://hmrc.gov.uk
// @version      1.3
// @updateURL     https://github.com/martin-armstrong/github-team-pr/raw/master/PR%20List.user.js
// @downloadURL   https://github.com/martin-armstrong/github-team-pr/raw/master/PR%20List.user.js
// @description  PR list for given list of repos
// @author       Martin Armstrong
// @match        https://github.com/orgs/*/teams/*
// @grant        none
//
// 1.3 - Fix PR Link and show PR's as discovered rather than when searching complete.
// 1.2 - Team repos discovered rather than hard coded for teams other than 'gg'
//     - Reload button added
//     - Sort option only re-orders displayed PR's, it doesn't reload the list.
//
// 1.1 - regex fix following html change in GitHub, also Jira links added
//
// ==/UserScript==

var prList = (function(){

var orgName = ""
var teamName = "";
var repoNames = [];

var STATUS = {
  APPROVED:"Approved",
  OPEN:"Open",
  CHANGES_REQUESTED:"Changes requested"
}

var SORT_BY = {
  DATE:"date",
  STATUS:"status",
  REPO:"repo",
  TICKET:"ticket"
}

function statusNumber(statusString){
  switch(statusString) {
      case STATUS.CHANGES_REQUESTED: return 2; break;
      case STATUS.OPEN: return 1; break;
      case STATUS.APPROVED: return 0; break;
      default: return 3;
  }
}

var props = (function(){
  var index = location.href.indexOf("teamPRList");
  if(index>-1) {
      return JSON.parse(decodeURIComponent(location.href.substring(index+"teamPRList".length+1)));
  } else {
      return {
        sortBy:SORT_BY.DATE
      }
  }
})();

var reposToLoad = repoNames.length;
var repoPRs = [];
var DOM_ID = {
  CONTAINER:"pr-list-container",
  HEADER:"pr-list-header",
  LIST:"pr-list",
  REFRESH_BUTTON:"pr-list-refresh"
}

function reloadWithProps(props) {
    console.log(props);
    console.log(JSON.toString(props));
  var index = location.href.indexOf('?') || location.href.length;
  location.assign(location.href.substring(0, index) + "?teamPRList="+JSON.stringify(props));
}

function setOrgAndTeamFromLocation() {
  var matches = window.location.href.match(new RegExp("https://github.com/orgs/([^/]+)/teams/([^/]+)")) || ["","",""];
  orgName = matches[1];
  teamName=matches[2];
}

function buildPullLinkRegex(orgName, repoName) {
    return new RegExp("<div[^<]+<a[^>]+data-hovercard-type=\"pull_request\"([^>]+>){17}","gmi");
}


function addPRLink(orgName, teamName) {
  var a = document.createElement("a");
  if(location.href.indexOf("teamPRList")>-1) {
    a.className="UnderlineNav-item no-wrap selected";
  }
  else {
    a.className="UnderlineNav-item no-wrap";
  }
  a.id = "pr-list-link";
  a.innerHTML = 'Pull Requests';
  a.style.cursor = "pointer";
  a.href="/orgs/"+orgName+"/teams/"+teamName+"/repositories?teamPRList={\"sortBy\":\""+SORT_BY.STATUS+"\"}"
  document.querySelector("nav.UnderlineNav-body[role='navigation']").append(a);
}

function loadPRData(orgName, repoName, callback) {
  fetch("https://github.com/"+orgName+"/"+repoName+"/pulls", {credentials: "same-origin"})
    .then(response => response.text())
    .then(responseText => {
      var links = responseText.match(buildPullLinkRegex(orgName, repoName)) || [];
      console.log("found "+links.length+" open PR links for repo: "+repoName);
      callback(links);
    });
}

function extractDate(linkHtml) {
    // e.g. datetime="2018-08-14T10:19:24Z"
    var dateStringMatched = (/datetime=\"([^\"]+)\"/gmi).exec(linkHtml) || ["not found", (new Date()).toDateString()]
    var dateObj = new Date(Date.parse(dateStringMatched[1]));
    console.log("extracted date: "+dateObj);
    return dateObj;
}

function extractStatus(linkHtml) {
    var matches = (new RegExp(">[\\s]*(("+STATUS.APPROVED+")|("+STATUS.CHANGES_REQUESTED+"))[\\s]*<","gmi")).exec(linkHtml) || ["", STATUS.OPEN];
    return matches[1];
}

function extractTicket(prLink) {
    var matches = (new RegExp(">([A-Za-z]+[- ]?[0-9]+)","mi")).exec(prLink) || ["", ""];
    if(matches[1]=="") {
        console.warn("No ticket number identified in: "+prLink);
    }
    var ticket = matches[1].toUpperCase().replace(" ", "-");
    return ticket;
}

function findReposForTeam(org, team, nextPageUrl, callback){ //https://github.com/orgs/hmrc/teams/gg/repositories
  fetch(nextPageUrl || "https://github.com/orgs/"+orgName+"/teams/"+team+"/repositories", {credentials: "same-origin"})
    .then(response => response.text())
    .then(responseText => {
      var repoNames = responseText.match(new RegExp('data-bulk-actions-id="([^"]+)"',"gmi")) || [];
      var nextLink = responseText.match(new RegExp('href="([^"]+)">Next<',"gmi")) || [];
      console.log(nextLink);
      repoNames = repoNames.map(htmlAtt=>htmlAtt.substring('data-bulk-actions-id="'.length, htmlAtt.length-1));
      if(nextLink.length>0 && nextLink[0].length>13) {
          nextLink = nextLink[0].substring(6, nextLink[0].length-7);
          console.log("Fetching repo names from: "+nextLink);
          findReposForTeam(org, team, nextLink, function(moreRepoNames){
            repoNames = [].concat(repoNames).concat(moreRepoNames);
            repoNames.forEach(repoName=>console.log("Found repoName: "+repoName));
            if(typeof callback=="function") callback(repoNames);
          })
      }
      else {
         repoNames.forEach(repoName=>console.log("Found repoName: "+repoName));
         if(typeof callback=="function") callback(repoNames);
      }
    });
}
window.findReposForTeam = findReposForTeam

function prDataParser(prLinkHTML, repoName){
  var div = document.createElement('div');
  div.innerHTML = prLinkHTML;
  var link = div.querySelector('a').outerHTML;
  console.log("Found div: "+prLinkHTML);
  var data = {
    link : link,
    ticket : extractTicket(link),
    openedBy: div.querySelector('span.opened-by').outerHTML,
    linkHtml : prLinkHTML,
    repoName : repoName,
    date : extractDate(prLinkHTML),
    status : extractStatus(prLinkHTML)
  }
  return data;
}

function getHeaderDiv() {
  var div = document.createElement("div");
  div.className="table-list-header table-list-header-next bulk-actions-header";
  var html = '<div class="table-list-filters d-flex">';
  html += '<span class="table-list-heading table-list-header-meta flex-auto">';

    html += ' <span id="'+DOM_ID.HEADER+'">## pull requests for team repos</span>';

    html += '<div style="float:right;padding-right:15px">';
    html += '<img id="'+DOM_ID.REFRESH_BUTTON+'" style="width:20px;position:relative;top:4px;cursor:pointer" title="Reload" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGmSURBVFhH7ZY5SgRBFEDHTBFz9wVF8SyCgSIiegEXNFE8iomRgeIaiMtNXHKNXUHcfa+ZgmZAe7GhQefBY6iiquvXdHX9X6lTJyOduICneI6P+ITX1b4V7MbCacd1fMXPBB2zgR1YCKP4gD78GbdxCoewGRuxFydwEx3j2Fscx0AIMBNL+I5O3MMBTKILd9A5HziPkjkAd+7ib+i7zcoiOtcgxjBTAL6/e3RCnsUDc+gzbqq/qQPwwDl4P2r9jgMMi6cKwHfoX+dh6rcjB/EFa03E79yBnva81C4aN5FjdKCfWilcogEMRq0SCKe/JWr9EdyMm3JzpeC1bQAXUasEZtAAjqJWAg78zrzsovNno1YCtYvGzYMJ7AVN06b1ROIL/vYqbsBD9FlrdqQhLB4SiAklL6voM6wNWu1IQwjAFGoqNS9YF2TBnbt4SOcjmJoQgFhMGIRtX0cPJuE7D3+7i5tbMhEPQCyr7tA+M+QWTmIfNqGXzDBOo6c9lGTOybTzn7BAsdBMW5R64NqwcKwVlvEEr9CS3Ov1DL1k/M4Lq4br/AcqlS/NoqKCkW1vxQAAAABJRU5ErkJggg=="> ';
    html += ' Sort By: <select id="pr-list-sort" >';
    html += '<option value="'+SORT_BY.DATE+'" '+(props.sortBy==SORT_BY.DATE?'selected':'')+'>Date</option>';
    html += '<option value="'+SORT_BY.STATUS+'" '+(props.sortBy==SORT_BY.STATUS?'selected':'')+' >Status</option>';
    html += '<option value="'+SORT_BY.REPO+'" '+(props.sortBy==SORT_BY.REPO?'selected':'')+' >Repository</option>';
    html += '<option value="'+SORT_BY.TICKET+'" '+(props.sortBy==SORT_BY.TICKET?'selected':'')+' >Ticket</option>';
    html += '</select></div>';

    html += '</span></div>';
  div.innerHTML = html;
  return div;
}

function setHeaderText(text) {
  document.getElementById(DOM_ID.HEADER).innerText = text;
}

function addPRRow(pr) {
    var ul = document.getElementById(DOM_ID.LIST);
    var li = document.createElement("li");
    var style = pr.status==STATUS.APPROVED ? 'background-color:#C2F7AB;' : 'background-color:#F3F7A1;';
    style = pr.status==STATUS.CHANGES_REQUESTED ? 'background-color:#F8CCBD;' : style;
    style += "padding:0px 10px 0px 10px;";
    li.className="table-list-item js-team-row js-bulk-actions-item";
    var html = "<div style=\""+style+"\">";
    html += pr.link + " : " + pr.openedBy;
    html += " : <a href=\"https://jira.tools.tax.service.gov.uk/browse/"+pr.ticket+"\">Jira</a>";
    html += "<div style=\"color:black;font-weight:600;float:right;\">"+pr.repoName+"</div>";
    html += "</div>";
    li.innerHTML = html;
    ul.appendChild(li);
}

function getContentDiv(){
  var div = document.createElement("div");
  var html = '<ul class="team-listing table-list table-list-bordered adminable" id="'+DOM_ID.LIST+'"></ul>'
  div.innerHTML = html;
  return div;
}

function changeSortBy(evt) {
    props.sortBy = evt.target.value;
    sortPrLinks(props.sortBy);
    renderRows();
}

function refreshHandler() {
  reloadWithProps(props);
}

function renderPRListContainer() {
  var existingContainer = document.getElementById(DOM_ID.CONTAINER)
  if(existingContainer) {
      existingContainer.parentNode.removeChild(existingContainer);
  }
  var div = document.createElement("div");
  div.className="js-check-all-container js-bulk-actions-container";
  div.id=DOM_ID.CONTAINER;
  div.appendChild(getHeaderDiv());
  div.appendChild(getContentDiv());
  document.querySelector(".container").style.width="90%";
  document.querySelector(".container").appendChild(div);

  document.getElementById('pr-list-sort').onchange = changeSortBy;
  document.getElementById(DOM_ID.REFRESH_BUTTON).onclick = refreshHandler
}

function sortByDate(prA, prB) {
  if(prA.date.getTime()<prB.date.getTime()) return -1;
  else if(prA.date.getTime()>prB.date.getTime()) return 1;
  else return 0;
}

function sortByStatus(prA, prB) {
  if([statusNumber(prA.status), statusNumber(prB.status)].sort().indexOf(statusNumber(prA.status))==0) {
      return 1;
  }
  return -1;
}

function sortByRepo(prA, prB) {
  if([prA.repoName, prB.repoName].sort().indexOf(prA.repoName)==0) {
      return 1;
  }
  return -1;
}

function sortByTicket(prA, prB) {
  if([prA.ticket, prB.ticket].sort().indexOf(prA.ticket)==0) {
      return 1;
  }
  return -1;
}

function sortPrLinks(sortBy) {
    if(sortBy == SORT_BY.STATUS) {
            repoPRs = repoPRs.sort(sortByStatus);
          } else if(sortBy == SORT_BY.REPO) {
            repoPRs = repoPRs.sort(sortByRepo);
          } else if(sortBy == SORT_BY.TICKET) {
            repoPRs = repoPRs.sort(sortByTicket);
          } else { //SORT_BY.DATE
            repoPRs = repoPRs.sort(sortByDate);
          }
}

function renderRows() {
    //clear any existing rows
    var ul = document.getElementById(DOM_ID.LIST);
    ul.innerHTML = "";
    //add rows
    repoPRs.forEach(pr=>addPRRow(pr));
}

function loadPRLinks(repoNames){
    //load PR links for each repo
    repoNames.forEach(repoName => {
      setHeaderText("Found "+repoPRs.length + " pull requests from 0 team repos. Loading "+repoName+"..");
      loadPRData(orgName, repoName, (links) => {
          reposToLoad--;
          var processedCount = repoNames.length - reposToLoad;
          links.forEach(linkHtml=>{
              repoPRs.push(prDataParser(linkHtml, repoName));
              sortPrLinks(props.sortBy);
              renderRows();
          });
          setHeaderText(" Found "+repoPRs.length + " pull requests from "+processedCount+" team repos. Loading "+repoName+"..");
        if(reposToLoad==0) {
          setHeaderText(" Found "+repoPRs.length + " pull requests from "+processedCount+" team repos.");
          console.log("DONE");
          console.log(repoPRs);
        }
      })
    });
}

function init(){
  setOrgAndTeamFromLocation();
  if(location.href.indexOf("teamPRList")>-1) {
    //unselect 'Repositories' nav link
    document.querySelector("a[class='UnderlineNav-item no-wrap selected']").className="UnderlineNav-item no-wrap";
    //hide repositories content
    document.querySelector("div.js-check-all-container").style.display="none";

    //add new container for pr list
    renderPRListContainer();

    setHeaderText(" Finding team repos..");

    if(repoNames.length>0) {
        loadPRLinks(repoNames);
    }
    else {
        findReposForTeam(orgName, teamName, null, function(repoNames){
            setHeaderText(" Found "+repoNames.length+" team repos.");
            loadPRLinks(repoNames);
        });
    }


  }
  addPRLink(orgName, teamName);
}

init();

return {
  props:props
};
})();
