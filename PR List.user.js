// ==UserScript==
// @name         PR-List
// @namespace    http://hmrc.gov.uk
// @version      1.9
// @description  PR list for given list of repos
// @author       Martin Armstrong
// @match        https://github.com/orgs/*/teams/*
// @grant        none
// @updateURL     https://github.com/martin-armstrong/github-team-pr/raw/master/PR%20List.user.js
// @downloadURL   https://github.com/martin-armstrong/github-team-pr/raw/master/PR%20List.user.js
//
//
// ==/UserScript==
//
// 1.9 - updates throughout due to GitHub content changes. switch to promises throughout.
// 1.8 - Fix status parsing, due to GitHub content change
// 1.7 - Switch to repo name exlusion patterns instead of white list. Add Team members only toggle.
// 1.6 - Show pending checks in a dark yellow. Adds colour key to header. Fix repo links.
// 1.5 - Show failing checks in red, same as 'Changes requested' status.
// 1.4 - Excludes Draft PRs from the list
// 1.3 - Fix PR Link and show PR's as discovered rather than when searching complete.
// 1.2 - Team repos discovered rather than hard coded for teams other than 'gg'
//     - Reload button added
//     - Sort option only re-orders displayed PR's, it doesn't reload the list.
//
// 1.1 - regex fix following html change in GitHub, also Jira links added

const prList = (function(){

const configRepoPatterns = [
  /app-config-.+/,
  /.+-config/,
  /build-jobs/,
  /.+-dashboards/,
  /.+-jobs/,
  /mdtp-frontend-routes/,
  /scripts/,
  /outage-pages/,
  /sbt-service-manager/
];

const testingRepoPatterns = [
  /.+test/,
  /.+tests/,
  /.+specs/,
  /.+testing/,
  /.+stub/,
  /.+perf/
];

const otherSharedRepoPatterns = [
  /domain/,
  /play-auth/,
  /play-authorisation/,
  /play-authorised-frontend/,
  /play-filters/,
  /saml/,
  /tax-year/,
  /play-sso/
];

const repoExclusions = configRepoPatterns.concat(testingRepoPatterns).concat(otherSharedRepoPatterns);


let orgName = "";
let teamName = "";
let teamMembers = [];

class Status {
    constructor(reviewState, number, colour) {
        this.reviewState = reviewState;
        this.number=number;
        this.colour=colour;
    }
}

class PR {
  constructor({link, ticket, openedBy, linkHtml, repoName, date, status, createdBy}) {
      this.link = link;
      this.ticket = ticket;
      this.openedBy = openedBy;
      this.linkHtml = linkHtml;
      this.repoName = repoName;
      this.date = date;
      this.status = status;
      this.createdBy = createdBy;
  }
}

const STATUS = {
  APPROVED:new Status("approved", 0, "#71bd5b70"),
  PENDING_REVIEW:new Status("none", 1, "#F3F7A1"),
  CHANGES_REQUESTED:new Status("changes_requested", 2, "#F8CCBD"),
  FAILED_CHECKS:new Status("?????", 2, "#e3957b"),
  DRAFT:new Status("?????", 3, "#FFFFFF"),
  PENDING_CHECKS:new Status("????", 4, "#fcc41c")
}

const SORT_BY = {
  DATE:"date",
  STATUS:"status",
  REPO:"repo",
  TICKET:"ticket"
}


const props = (function(){
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

let reposToLoad = 0;
let repoPRs = [];
const DOM_ID = {
  CONTAINER:"pr-list-container",
  HEADER:"pr-list-header",
  LIST:"pr-list",
  REFRESH_BUTTON:"pr-list-refresh"
}

//reload the page with the given props in query string
function reloadWithProps(props) {
  var index = location.href.indexOf('?') || location.href.length;
  location.assign(location.href.substring(0, index) + "?teamPRList="+JSON.stringify(props));
}

//read the page url, extract organisation and team name, then set globals orgName and teamName
function setOrgAndTeamFromLocation() {
  var matches = window.location.href.match(new RegExp("https://github.com/orgs/([^/]+)/teams/([^/]+)")) || ["","",""];
  orgName = matches[1];
  teamName = matches[2];
}

// add the "pull requests" button in top toolbar
function addPRLink(orgName, teamName) {
  let firstIconButton = document.querySelector("div[data-testid='top-bar-actions'] div[data-component='Stack'] a[data-component='IconButton']");
  let a = document.createElement("a");
  a.className=firstIconButton.className;
  a.id = "pr-list-link";
  a.innerHTML = 'Pull Requests';
  a.style.cursor = "pointer";
    a.style.width = "fit-content";
    a.style.padding = "0px 5px 0px 5px";
  a.href=`/orgs/${orgName}/teams/${teamName}/repositories?teamPRList={\"sortBy\":\"${SORT_BY.STATUS}\"}`;
  firstIconButton.parentElement.appendChild(a);
}

//  <script[^>]+>({"payload":{"repoPullsDashboardContentRoute"[^<]+)<
//  <script type="application/json" data-target="react-app.embeddedData">{"payload":{"repoPullsDashboardContentRoute":{"results":[
const pullLinkRegex = new RegExp('<script[^>]+>({"payload":{"repoPullsDashboardContentRoute":{"results"[^<]+)</script>',"gmi");


//read the pull requests for a given repo that have the given reviewState (one of none, approved, required, changes_requested)
//returns promise of pull requests (json as extracted from the page)
function loadPRDataWithReviewState(orgName, repoName, reviewState) {
  return fetch(`https://github.com/${orgName}/${repoName}/pulls?q=is%3Apr+state%3Aopen+review%3A${reviewState}`, {credentials: "same-origin"})
    .then(response => response.text())
    .then(responseText => {
      let pullsJson = pullLinkRegex.exec(responseText);
      pullLinkRegex.lastIndex = 0;
      let pulls = [];
      if(pullsJson!==null && pullsJson.length>1) {
          let pullsPayload = JSON.parse(pullsJson[1]);
          pulls = pullsPayload.payload.repoPullsDashboardContentRoute.results;
          console.debug(`found ${pulls.length} open PRs for repo: ${repoName} with reviewState ${reviewState}`);
      } else {
          console.debug(`pullsJson not found for repo: ${repoName} with reviewState ${reviewState}`);
          if(repoName=="bas-gateway-frontend" || repoName=="auth") {
            console.debug(responseText);
            console.debug(pullLinkRegex.exec(responseText));
          }
      }
      return pulls;
    });
}

//try to extract ticket ref from pr title
function extractTicket(prTitle) {
    var matches = (new RegExp("([A-Za-z]+[- ]?[0-9]+)","mi")).exec(prTitle) || ["", ""];
    if(matches[1]=="") {
        console.warn(`No ticket number identified in PR title: ${prTitle}`);
    }
    var ticket = matches[1].toUpperCase().replace(" ", "-");
    return ticket;
}

//extract fields from a pull json found in pulls page abd create new PR
function parsePRData(pull, reviewState){
  let statusObj = STATUS.PENDING_REVIEW;
    switch(reviewState) {
        case STATUS.APPROVED.reviewState: statusObj=STATUS.APPROVED; break;
        case STATUS.CHANGES_REQUESTED.reviewState: statusObj=STATUS.CHANGES_REQUESTED; break;
            //case STATUS.DRAFT.reviewState: statusObj=STATUS.DRAFT; break;
            //case STATUS.PENDING_REVIEW.reviewState: statusObj=STATUS.PENDING_REVIEW; break;
        default: statusObj=STATUS.PENDING_REVIEW;
    }

  return new PR ({
    link : pull.permalink,
    ticket : extractTicket(pull.title),
    openedBy : pull.author.displayLogin,
    linkHtml : pull.titleHtml.value,
    repoName : pull.repoNameWithOwner,
    date : new Date(Date.parse(pull.createdAt)),
    status : statusObj,
    createdBy : pull.author.displayLogin
  });
}

function loadPRData(orgName, repoName) {
    return Promise.all([
      loadPRDataWithReviewState(orgName, repoName, STATUS.PENDING_REVIEW.reviewState).then((pulls)=>pulls.map((pull)=>parsePRData(pull, STATUS.PENDING_REVIEW.reviewState))),
      loadPRDataWithReviewState(orgName, repoName, STATUS.APPROVED.reviewState).then((pulls)=>pulls.map((pull)=>parsePRData(pull, STATUS.APPROVED.reviewState))),
      loadPRDataWithReviewState(orgName, repoName, STATUS.CHANGES_REQUESTED.reviewState).then((pulls)=>pulls.map((pull)=>parsePRData(pull, STATUS.CHANGES_REQUESTED.reviewState))),
    ]).then((prLists)=>{
        let allPrs = prLists.flat();
        console.debug(`Found ${allPrs.length} open PRs for repo ${repoName}`);
        return allPrs;
    });
}


//walk through repositories pages collecting the repo names
function findReposForTeam(org, team, _nextPageUrl){
  let nextPageUrl = _nextPageUrl || "https://github.com/orgs/"+orgName+"/teams/"+team+"/repositories";
  if(!_nextPageUrl) {
    setHeaderText(` Finding team repos in : ${nextPageUrl}`);
  }
  return fetch(nextPageUrl, {credentials: "same-origin"})
    .then(response => response.text())
    .then(responseText => {
      let repoNames = (responseText.match(new RegExp('data-bulk-actions-id="([^"]+)"',"gmi")) || []).map(
         htmlAtt => htmlAtt.substring('data-bulk-actions-id="'.length, htmlAtt.length-1)
      );
      repoNames.forEach(repoName=>console.debug(`Found repoName: ${repoName}`));

      setHeaderText(` Found ${repoNames.length} team repos in : ${nextPageUrl}`);

      let nextLink = responseText.match(new RegExp('href="([^"]+)">Next<',"gmi")) || [];

      if(nextLink.length==0 || nextLink[0].length<14) {
        return repoNames;
      }
      else {
          nextLink = nextLink[0].substring(6, nextLink[0].length-7);
          console.debug(` Fetching repo names from ${nextLink}`);
          return findReposForTeam(org, team, nextLink).then(nextPageRepoNames => {
            repoNames = [].concat(repoNames).concat(nextPageRepoNames);
            return repoNames;
          })
      }
    });
}
window.findReposForTeam = findReposForTeam


function findTeamMembers(org, team, _nextPageUrl){ //https://github.com/orgs/hmrc/teams/gg/members
  let nextPageUrl = _nextPageUrl || "https://github.com/orgs/"+orgName+"/teams/"+team+"/members";
  if(!_nextPageUrl) {
    setHeaderText(` Finding team members in : ${nextPageUrl}`);
  }
  return fetch(nextPageUrl, {credentials: "same-origin"})
    .then(response => response.text())
    .then(responseText => {

      let memberIds = responseText.match(new RegExp('data-bulk-actions-id="([^"]+)"',"gmi")) || [];
      let nextLink = responseText.match(new RegExp('href="([^"]+)">Next<',"gmi")) || [];
      memberIds = memberIds.map(htmlAtt=>htmlAtt.substring('data-bulk-actions-id="'.length, htmlAtt.length-1));
      memberIds.forEach(memberId=>console.debug(`Found team member ID: ${memberId}`));

      setHeaderText(` Found ${memberIds.length} team members in : ${nextPageUrl}`);

      if(nextLink.length==0 || nextLink[0].length<14) {
         return memberIds;
      } else {
          nextLink = nextLink[0].substring(6, nextLink[0].length-7);
          console.debug(`Fetching more team member IDs from: ${nextLink}`);
          return findTeamMembers(org, team, nextLink).then(moreMemberIDs => [].concat(memberIds).concat(moreMemberIDs))
      }
    });
}
window.findTeamMembers = findTeamMembers

function getStyle() {
  let style = document.createElement("style");
  let css = '#header-controls {display:inline-block;float:right;padding-right:15px;}';
      css += '#key {display:inline-block;margin-right:10px;}';
      css += 'span.key-cell {padding:2px 5px 2px 5px;}';
      css += "#"+DOM_ID.REFRESH_BUTTON+" {margin-left:10px;width:20px;position:relative;top:4px;cursor:pointer;margin-right:20px;}";
      css += "#toggle-team-members-only {margin-right:10px;}";

  style.innerText = css;
  return style;
}

function getHeaderDiv() {
  let div = document.createElement("div");
  div.className="table-list-header table-list-header-next bulk-actions-header";
  let html = '<div class="table-list-filters d-flex">';
  html += '<span class="table-list-heading table-list-header-meta flex-auto">';

    html += ' <span id="'+DOM_ID.HEADER+'">## pull requests for team repos</span>';

    html += '<div id="header-controls">';
    html += '<div id="key">Key: ';
    html += '<span class="key-cell" style="background-color:'+STATUS.APPROVED.colour+';">Approved</span>';
    html += '<span class="key-cell" style="background-color:'+STATUS.PENDING_REVIEW.colour+';">Pending Review</span>';
    html += '<span class="key-cell" style="background-color:'+STATUS.CHANGES_REQUESTED.colour+';">Changes Required</span>';
    //html += '<span class="key-cell" style="background-color:'+STATUS.PENDING_CHECKS.colour+';">Pending Checks</span>';
    //html += '<span class="key-cell" style="background-color:'+STATUS.FAILED_CHECKS.colour+';">Failed Checks</span>';
    html += '</div>';
    html += '<img id="'+DOM_ID.REFRESH_BUTTON+'" title="Reload" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGmSURBVFhH7ZY5SgRBFEDHTBFz9wVF8SyCgSIiegEXNFE8iomRgeIaiMtNXHKNXUHcfa+ZgmZAe7GhQefBY6iiquvXdHX9X6lTJyOduICneI6P+ITX1b4V7MbCacd1fMXPBB2zgR1YCKP4gD78GbdxCoewGRuxFydwEx3j2Fscx0AIMBNL+I5O3MMBTKILd9A5HziPkjkAd+7ib+i7zcoiOtcgxjBTAL6/e3RCnsUDc+gzbqq/qQPwwDl4P2r9jgMMi6cKwHfoX+dh6rcjB/EFa03E79yBnva81C4aN5FjdKCfWilcogEMRq0SCKe/JWr9EdyMm3JzpeC1bQAXUasEZtAAjqJWAg78zrzsovNno1YCtYvGzYMJ7AVN06b1ROIL/vYqbsBD9FlrdqQhLB4SiAklL6voM6wNWu1IQwjAFGoqNS9YF2TBnbt4SOcjmJoQgFhMGIRtX0cPJuE7D3+7i5tbMhEPQCyr7tA+M+QWTmIfNqGXzDBOo6c9lGTOybTzn7BAsdBMW5R64NqwcKwVlvEEr9CS3Ov1DL1k/M4Lq4br/AcqlS/NoqKCkW1vxQAAAABJRU5ErkJggg=="> ';
    html += ' Team Members Only: <input type="checkbox" id="toggle-team-members-only" '+(props.teamMembersOnly?'CHECKED':'')+' ></input>';
    html += ' Sort By: <select id="pr-list-sort" >';
    html += '<option value="'+SORT_BY.DATE+'" '+(props.sortBy==SORT_BY.DATE?'selected':'')+'>Date</option>';
    html += '<option value="'+SORT_BY.STATUS+'" '+(props.sortBy==SORT_BY.STATUS?'selected':'')+' >Status</option>';
    html += '<option value="'+SORT_BY.REPO+'" '+(props.sortBy==SORT_BY.REPO?'selected':'')+' >Repository</option>';
    html += '<option value="'+SORT_BY.TICKET+'" '+(props.sortBy==SORT_BY.TICKET?'selected':'')+' >Ticket</option>';
    html += '</select>';
    html += '</div>';

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
    let ul = document.getElementById(DOM_ID.LIST);
    let li = document.createElement("li");
    let style = `background-color:${pr.status.colour};`;
    style += "padding:0px 10px 0px 10px;";
    li.className="table-list-item js-team-row js-bulk-actions-item";

    let html = `<div style="${style}">`;
    html += `${pr.date.toDateString()} : <a href="${pr.link}">${pr.linkHtml}</a> : ${pr.openedBy}`;
    if(pr.ticket.length>0) {
      html += ` : <a href="https://jira.tools.tax.service.gov.uk/browse/${pr.ticket}">${pr.ticket}</a>`;
    }
    html += "<div style=\"float:right;\">";
    html += `<a class='link-gray-dark v-align-middle no-underline h4 js-navigation-open' data-hovercard-type='repository' data-hovercard-url='/hmrc/${pr.repoName}/hovercard' href='https://github.com/hmrc/${pr.repoName}'>${pr.repoName}</a>`;
    html += "</div>";
    html += "</div>";
    li.innerHTML = html;
    ul.appendChild(li);
}

function getContentDiv(){
  let div = document.createElement("div");
  let html = `<ul class="team-listing table-list table-list-bordered adminable" id="${DOM_ID.LIST}"></ul>`
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
  let existingContainer = document.getElementById(DOM_ID.CONTAINER)
  if(existingContainer) {
      existingContainer.parentNode.removeChild(existingContainer);
  }
  let div = document.createElement("div");
  div.className="js-check-all-container js-bulk-actions-container";
  div.id=DOM_ID.CONTAINER;
  div.appendChild(getStyle());
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
    let ul = document.getElementById(DOM_ID.LIST);
    ul.innerHTML = ""; //clear current content first
    repoPRs.forEach(pr=>addPRRow(pr));
}

function logRepoParseDone(prCount, repoCount, repoTotal, repoName) {
  if(repoCount==repoTotal) { //done all repos
    setHeaderText(`Found ${prCount} pull requests in ${repoCount}/${repoTotal} repos.`);
  }
  else {
    setHeaderText(`Found ${prCount} pull requests in ${repoCount}/${repoTotal} repos. Parsing ${repoName}...`);
  }
}

function loadPRs(repoNames){
    let reposToLoad = repoNames.length;
    let processedRepoCount = 0;
    //load pulls for each repo
    setHeaderText(`Finding pull requests from ${repoNames.length} team repos...`);
    repoNames.forEach(repoName => {
      loadPRData(orgName, repoName).then(pulls => {
          let prsToProcess = pulls.length;
          let processedPRCount = 0;

          pulls.forEach(prData=>{
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

          if(pulls.length==0) {
              processedRepoCount++;
              logRepoParseDone(repoPRs.length, processedRepoCount, reposToLoad, repoName);
          }
      });
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
    document.querySelector("a[data-tab-item='repositories']").removeAttribute("aria-current");
    //hide repositories content
    document.querySelector("div.js-check-all-container").style.display="none";

    //add new container for pr list
    renderPRListContainer();

    setHeaderText(" Finding repositories...");

    findReposForTeam(orgName, teamName, null).then(rawRepoNames => {
      var repoNames = filteredRepoNames(rawRepoNames);
      setHeaderText(" Finding team members...");
      findTeamMembers(orgName, teamName, null).then(teamMemberIds=>{
        teamMembers = teamMemberIds;
        loadPRs(repoNames);
      });
    });

  }
  addPRLink(orgName, teamName);
}

setTimeout(init, 500);

return {
  props:props
};
})();
