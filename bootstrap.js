const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/Home.jsm");
Cu.import("resource://gre/modules/HomeProvider.jsm");
Cu.import("resource://gre/modules/Prompt.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const ADDON_ID = "wikipedia.panel@margaretleibovic.com";
const PANEL_ID = "wikipedia.panel@margaretleibovic.com";
const DATASET_ID = "wikipedia.dataset@margaretleibovic.com";

const FEED_PREF = "wikipediaPanel.feed";

XPCOMUtils.defineLazyGetter(this, "Strings", function() {
  return Services.strings.createBundle("chrome://wikipediapanel/locale/wikipediapanel.properties");
});

XPCOMUtils.defineLazyGetter(this, "FeedHelper", function() {
  let win = Services.wm.getMostRecentWindow("navigator:browser");
  Services.scriptloader.loadSubScript("chrome://wikipediapanel/content/FeedHelper.js", win);
  return win["FeedHelper"];
});

var Feeds = ["potd", "featured", "onthisday"];

function getFeed() {
  try {
    // First check to see if the user has set a pref for this add-on.
    let feed = Services.prefs.getCharPref(FEED_PREF);
    if (Feeds.indexOf(feed) > -1) {
      return feed;
    }
  } catch (e) {}

  // Default to the featured feed.
  return "featured";
}

function optionsCallback() {
  return {
    title: Strings.GetStringFromName("title"),
    views: [{
      type: Home.panels.View.LIST,
      dataset: DATASET_ID,
      onrefresh: refreshDataset
    }]
  };
}

function refreshDataset() {
  let domain = Strings.GetStringFromName("domain");

  let feedUrl = [
    "http://",
    domain,
    "/w/api.php?action=featuredfeed&feed=",
    getFeed()
  ].join("");

  FeedHelper.parseFeed(feedUrl, function(parsedFeed) {
    let items = FeedHelper.feedToItems(parsedFeed).map(function(item){
      // Image URLs don't include a scheme
      item.image_url = "http:" + item.image_url;
      return item;
    });

    Task.spawn(function() {
      let storage = HomeProvider.getStorage(DATASET_ID);
      yield storage.deleteAll();
      yield storage.save(items);
    }).then(null, e => Cu.reportError("Error saving data to HomeProvider: " + e));
  });
}

function deleteDataset() {
  Task.spawn(function() {
    let storage = HomeProvider.getStorage(DATASET_ID);
    yield storage.deleteAll();
  }).then(null, e => Cu.reportError("Error deleting data from HomeProvider: " + e));
}

function optionsDisplayed(doc, topic, id) {
  if (id != ADDON_ID) {
    return;
  }

  let setting = doc.getElementById("feed-setting");
  setting.setAttribute("title", Strings.GetStringFromName("feed.label"));

  let select = doc.getElementById("feed-select");
  for (let feed of Feeds) {
    let option = doc.createElement("option");
    option.value = feed;
    option.textContent = Strings.GetStringFromName(feed);
    select.appendChild(option);
  }

  select.value = getFeed();

  select.addEventListener("change", function() {
    Services.prefs.setCharPref(FEED_PREF, select.value);
    HomeProvider.requestSync(DATASET_ID, refreshDataset);
  }, false);
}

/**
 * bootstrap.js API
 * https://developer.mozilla.org/en-US/Add-ons/Bootstrapped_extensions
 */
function startup(data, reason) {
  // Always register your panel on startup.
  Home.panels.register(PANEL_ID, optionsCallback);

  switch(reason) {
    case ADDON_INSTALL:
    case ADDON_ENABLE:
      Home.panels.install(PANEL_ID);
      refreshDataset();
      break;

    case ADDON_UPGRADE:
    case ADDON_DOWNGRADE:
      Home.panels.update(PANEL_ID);
      break;
  }

  // Update data once every hour.
  HomeProvider.addPeriodicSync(DATASET_ID, 3600, refreshDataset);

  Services.obs.addObserver(optionsDisplayed, AddonManager.OPTIONS_NOTIFICATION_DISPLAYED, false);
}

function shutdown(data, reason) {
  if (reason == ADDON_UNINSTALL || reason == ADDON_DISABLE) {
    Home.panels.uninstall(PANEL_ID);
    HomeProvider.removePeriodicSync(DATASET_ID);
    deleteDataset();
  }

  Home.panels.unregister(PANEL_ID);

  Services.obs.removeObserver(optionsDisplayed, AddonManager.OPTIONS_NOTIFICATION_DISPLAYED);
}

function install(data, reason) {}

function uninstall(data, reason) {}
