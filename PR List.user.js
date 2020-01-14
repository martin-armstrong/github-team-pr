// ==UserScript==
// @name         PR-List
// @namespace    http://hmrc.gov.uk
// @version      1.7
// @description  PR list for given list of repos
// @author       Martin Armstrong
// @match        https://github.com/orgs/*/teams/*
// @grant        none
// @updateURL     https://github.com/martin-armstrong/github-team-pr/raw/master/PR%20List.user.js
// @downloadURL   https://github.com/martin-armstrong/github-team-pr/raw/master/PR%20List.user.js
//
// 1.7 - Switch to repo name exclusion patterns instead of white list. Add Team members only toggle.
// 1.6 - Show pending checks in a dark yellow. Adds colour key to header. Fix repo links.
// 1.5 - Show failing checks in red, same as 'Changes requested' status.
// 1.4 - Excludes Draft PRs from the list
// 1.3 - Fix PR Link and show PR's as discovered rather than when searching complete.
// 1.2 - Team repos discovered rather than hard coded for teams other than 'gg'
//     - Reload button added
//     - Sort option only re-orders displayed PR's, it doesn't reload the list.
//
// 1.1 - regex fix following html change in GitHub, also Jira links added
//
// ==/UserScript==

var prList = (function(){

var repoExclusions = [
  /app-config-.+/,
  /.+test/,
  /.+tests/,
  /.+specs/,
  /.+testing/,
  /.+-config/,
  /build-jobs/,
  /domain/,
  /.+stub/,
  /.+perf/,
  /.+-dashboards/,
  /.+-jobs/,
  /mdtp-frontend-routes/,
  /play-auth/,
  /play-authorisation/,
  /play-authorised-frontend/,
  /play-filters/,
  /saml/,
  /scripts/,
  /tax-year/,
  /play-sso/,
  /outage-pages/,
  /sbt-service-manager/
];


var orgName = "";
var teamName = "";
var teamMembers = [];

function Status(matchText, number, colour) {
  this.matchText = matchText;
  this.number=number;
  this.colour=colour;
}

var STATUS = {
  APPROVED:new Status("Approved", 0, "#71bd5b"),
  PENDING_REVIEW:new Status("Open", 1, "#F3F7A1"),
  CHANGES_REQUESTED:new Status("Changes requested", 2, "#F8CCBD"),
  FAILED_CHECKS:new Status("Failed checks", 2, "#e3957b"),
  DRAFT:new Status("Draft", 3, "#FFFFFF"),
  PENDING_CHECKS:new Status("Pending: Build triggered", 4, "#fcc41c")
}

var SORT_BY = {
  DATE:"date",
  STATUS:"status",
  REPO:"repo",
  TICKET:"ticket"
}


var props = (function(){
  var index = location.href.indexOf("teamPRList");
  var defaultProps = {
        sortBy:SORT_BY.DATE,
        teamMembersOnly:true
      };
  if(index>-1) {
      var parsedJson = JSON.parse(decodeURIComponent(location.href.substring(index+"teamPRList".length+1)));
      parsedJson.sortBy = parsedJson.sortBy || defaultProps.sortBy;
      parsedJson.teamMembersOnly = (typeof parsedJson.teamMembersOnly) == "boolean" ? parsedJson.teamMembersOnly : defaultProps.teamMembersOnly;
      return parsedJson;
  } else {
      return defaultProps;
  }
})();

var reposToLoad = 0;
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
    return new RegExp("<div[^<]+<a[^>]+data-hovercard-type=\"pull_request\"([^>]+>){22}","gmi");
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
    var statusObj = null;
    if(new RegExp('aria\-label="Failure\:', "gmi").exec(linkHtml) != null) {
        statusObj = STATUS.FAILED_CHECKS;
    }
    else if(new RegExp('aria\-label="Pending\: Build triggered', "gmi").exec(linkHtml) != null) {
        statusObj = STATUS.PENDING_CHECKS;
    }
    else {
        var matches = (new RegExp(">[\\s]*(("+STATUS.APPROVED.matchText+")|("+STATUS.CHANGES_REQUESTED.matchText+")|("+STATUS.DRAFT.matchText+"))[\\s]*<","gmi")).exec(linkHtml) || ["", STATUS.PENDING_REVIEW.matchText];
        switch(matches[1]) {
            case STATUS.APPROVED.matchText: statusObj=STATUS.APPROVED; break;
            case STATUS.CHANGES_REQUESTED.matchText: statusObj=STATUS.CHANGES_REQUESTED; break;
            case STATUS.DRAFT.matchText: statusObj=STATUS.DRAFT; break;
            case STATUS.PENDING_REVIEW.matchText: statusObj=STATUS.PENDING_REVIEW; break;
            default: statusObj=STATUS.PENDING_REVIEW;
        }
    }
    console.log("extracted status : "+statusObj.matchText);
    return statusObj;
}

function extractCreatedBy(prLink) {
  var matches = (new RegExp('"Open pull requests created by ([^"]+)"')).exec(prLink) || ["", ""];
  if(matches[1]=="") {
    console.warn("No created by team member identified in: "+prLink);
  }
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

function findReposForTeam(org, team, _nextPageUrl, callback){ //https://github.com/orgs/hmrc/teams/gg/repositories
  var nextPageUrl = _nextPageUrl || "https://github.com/orgs/"+orgName+"/teams/"+team+"/repositories";
  if(!_nextPageUrl) {
    setHeaderText(" Finding team repos in : "+nextPageUrl);
  }
  fetch(nextPageUrl, {credentials: "same-origin"})
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


function findTeamMembers(org, team, _nextPageUrl, callback){ //https://github.com/orgs/hmrc/teams/gg/members
  var nextPageUrl = _nextPageUrl || "https://github.com/orgs/"+orgName+"/teams/"+team+"/members";
  if(!_nextPageUrl) {
    setHeaderText(" Finding team members in : "+nextPageUrl);
  }
  fetch(nextPageUrl, {credentials: "same-origin"})
    .then(response => response.text())
    .then(responseText => {
      var memberIds = responseText.match(new RegExp('data-bulk-actions-id="([^"]+)"',"gmi")) || [];
      var nextLink = responseText.match(new RegExp('href="([^"]+)">Next<',"gmi")) || [];
      memberIds = memberIds.map(htmlAtt=>htmlAtt.substring('data-bulk-actions-id="'.length, htmlAtt.length-1));
      if(nextLink.length>0 && nextLink[0].length>13) {
          nextLink = nextLink[0].substring(6, nextLink[0].length-7);
          console.log("Fetching team member IDs from: "+nextLink);
          findTeamMembers(org, team, nextLink, function(moreMemberIDs){
            memberIds = [].concat(memberIds).concat(moreMemberIDs);
            memberIds.forEach(memberId=>console.log("Found team member ID: "+memberId));
            if(typeof callback=="function") callback(memberIds);
          })
      }
      else {
         memberIds.forEach(memberId=>console.log("Found team member ID: "+memberId));
         if(typeof callback=="function") callback(memberIds);
      }
    });
}
window.findTeamMembers = findTeamMembers

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
    status : extractStatus(prLinkHTML),
    createdBy: extractCreatedBy(prLinkHTML)
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
    html += '<span>Key: </span>';
    html += '<span style="background-color:'+STATUS.APPROVED.colour+';padding:2px 5px 2px 5px;">Approved</span>';
    html += '<span style="background-color:'+STATUS.PENDING_REVIEW.colour+';padding:2px 5px 2px 5px;">Pending Review</span>';
    html += '<span style="background-color:'+STATUS.CHANGES_REQUESTED.colour+';padding:2px 5px 2px 5px;">Changes Required</span>';
    html += '<span style="background-color:'+STATUS.PENDING_CHECKS.colour+';padding:2px 5px 2px 5px;">Pending Checks</span>';
    html += '<span style="background-color:'+STATUS.FAILED_CHECKS.colour+';padding:2px 5px 2px 5px;">Failed Checks</span>';
    html += '<img id="'+DOM_ID.REFRESH_BUTTON+'" style="margin-left:20px;width:20px;position:relative;top:4px;cursor:pointer" title="Reload" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGmSURBVFhH7ZY5SgRBFEDHTBFz9wVF8SyCgSIiegEXNFE8iomRgeIaiMtNXHKNXUHcfa+ZgmZAe7GhQefBY6iiquvXdHX9X6lTJyOduICneI6P+ITX1b4V7MbCacd1fMXPBB2zgR1YCKP4gD78GbdxCoewGRuxFydwEx3j2Fscx0AIMBNL+I5O3MMBTKILd9A5HziPkjkAd+7ib+i7zcoiOtcgxjBTAL6/e3RCnsUDc+gzbqq/qQPwwDl4P2r9jgMMi6cKwHfoX+dh6rcjB/EFa03E79yBnva81C4aN5FjdKCfWilcogEMRq0SCKe/JWr9EdyMm3JzpeC1bQAXUasEZtAAjqJWAg78zrzsovNno1YCtYvGzYMJ7AVN06b1ROIL/vYqbsBD9FlrdqQhLB4SiAklL6voM6wNWu1IQwjAFGoqNS9YF2TBnbt4SOcjmJoQgFhMGIRtX0cPJuE7D3+7i5tbMhEPQCyr7tA+M+QWTmIfNqGXzDBOo6c9lGTOybTzn7BAsdBMW5R64NqwcKwVlvEEr9CS3Ov1DL1k/M4Lq4br/AcqlS/NoqKCkW1vxQAAAABJRU5ErkJggg=="> ';
    html += ' Team Members Only: <input type="checkbox" id="toggle-team-members-only" '+(props.teamMembersOnly?'CHECKED':'')+' ></input>';
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
    if(props.teamMembersOnly && teamMembers.indexOf(pr.createdBy)==-1) {
      return;
    }
    var ul = document.getElementById(DOM_ID.LIST);
    var li = document.createElement("li");
    var style = "background-color:"+pr.status.colour+";";
    style += "padding:0px 10px 0px 10px;";
    li.className="table-list-item js-team-row js-bulk-actions-item";

    var html = "<div style=\""+style+"\">";
    html += pr.link + " : " + pr.openedBy;
    if(pr.ticket.length>0) {
      html += " : <a href=\"https://jira.tools.tax.service.gov.uk/browse/"+pr.ticket+"\">Jira</a>";
    }
    html += "<div style=\"float:right;\">";
    html += "<a class='link-gray-dark v-align-middle no-underline h4 js-navigation-open' data-hovercard-type='repository' data-hovercard-url='/hmrc/"+pr.repoName+"/hovercard' href='https://github.com/hmrc/"+pr.repoName+"'>"+pr.repoName+"</a>";
    html += "</div>";
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

function toggleTeamMembersOnly(evt) {
    props.teamMembersOnly = !props.teamMembersOnly;
    reloadWithProps(props);
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

  document.getElementById('toggle-team-members-only').onchange = toggleTeamMembersOnly;
  document.getElementById('pr-list-sort').onchange = changeSortBy;
  document.getElementById(DOM_ID.REFRESH_BUTTON).onclick = refreshHandler
}

function sortByDate(prA, prB) {
  if(prA.date.getTime()<prB.date.getTime()) return -1;
  else if(prA.date.getTime()>prB.date.getTime()) return 1;
  else return 0;
}

function sortByStatus(prA, prB) {
  if([prA.status.number, prB.status.number].sort().indexOf(prA.status.number)==0) {
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

function logRepoParseDone(prCount, repoCount, repoTotal, repoName) {
  if(repoCount==repoTotal) { //done all repos
    setHeaderText("Found "+prCount+" pull requests in "+repoCount+" repos.");
    console.log(repoPRs);
  }
  else {
    setHeaderText("Found "+prCount+" pull requests in "+repoCount+" repos. Parsing "+repoName+"...");
  }
}

function loadPRLinks(repoNames){
    var reposToLoad = repoNames.length;
    var processedRepoCount = 0;
    //load PR links for each repo
    setHeaderText("Finding pull requests for "+repoNames.length+" team repos...");
    repoNames.forEach(repoName => {
      loadPRData(orgName, repoName, (links) => {
          var prsToProcess = links.length;
          var processedPRCount = 0;

          links.forEach(linkHtml=>{
              var prData = prDataParser(linkHtml, repoName);
              if(prData.status!=STATUS.DRAFT) {
                repoPRs.push(prData);
                sortPrLinks(props.sortBy);
                renderRows();
              }
              processedPRCount++;

              if(processedPRCount==prsToProcess) { //done all PRs in current repo
                  processedRepoCount++;
                  logRepoParseDone(repoPRs.length, processedRepoCount, reposToLoad, repoName);
              }
          });

          if(links.length==0) {
              processedRepoCount++;
              logRepoParseDone(repoPRs.length, processedRepoCount, reposToLoad, repoName);
          }
      })
    });
}

function filteredRepoNames(repoNames) {
  return repoNames.filter((name)=>{
      return repoExclusions.filter((exlusion)=>{
        return exlusion.test(name)
      }).length == 0; //no exclusion regexes should match the repo name
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

    setHeaderText(" Finding repositories...");

    findReposForTeam(orgName, teamName, null, function(_repoNames){
      var repoNames = filteredRepoNames(_repoNames);
      setHeaderText(" Finding team members...");
      findTeamMembers(orgName, teamName, null, (teamMemberIds)=>{
        teamMembers = teamMemberIds;
        loadPRLinks(repoNames);
      });
    });

  }
  addPRLink(orgName, teamName);
}

init();

return {
  props:props
};
})();
