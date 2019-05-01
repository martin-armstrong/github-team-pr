# github-team-pr
TamperMonkey browser extension to show pull requests for all repos in your github team.

This adds an additional tab into your GitHub team page, showing Pull Requests across all repos found under your team repositories tab, and colour coded as follows..\
<span style="color: rgb(255,204,0);">Yellow</span> : Request awaiting review\
<span style="color: rgb(255,102,0);">Red</span> : Reviewed, awaiting changes\
<span style="color: rgb(51,153,102);">Green</span> : Reviewed and approved

# Setup
Install the TamperMonkey extension on your browser of choice ([Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en) / [Firefox](https://addons.mozilla.org/en-GB/firefox/addon/tampermonkey/)).\
With the extension installed, right click [here](https://github.com/martin-armstrong/github-team-pr/raw/master/PR%20List.user.js) and select open in new tab where you'll be prompted to install the script into TamperMonkey.\
In the top right corner of your browser click the TamperMonkey symbol, then the "Dashboard" option.\
This will show you a list of all the scripts you have installed and enabled, check the PR List script is installed and running.\
With this activated, open up GitHub and navigate to your Team page. You should see a new Pull Requests tab has appeared, clicking this shows links to all your teams open pull requests.
        
