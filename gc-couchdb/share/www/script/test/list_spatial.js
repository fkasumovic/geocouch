// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

couchTests.list_spatial = function(debug) {
  var db = new CouchDB("test_suite_db", {"X-Couch-Full-Commit":"false"});
  db.deleteDb();
  db.createDb();
  if (debug) debugger;

  var designDoc = {
    _id:"_design/lists",
    language: "javascript",
    spatial : {
      basicIndex : stringFun(function(doc) {
        emit({
          type: "Point",
          coordinates: [doc.loc[0], doc.loc[1]]
        }, doc.string);
      })
    },
    lists: {
      basicBasic : stringFun(function(head, req) {
        send("head");
        var row;
        while(row = getRow()) {
          log("row: "+toJSON(row));
          send(row.id);
          //send("row");
        };
        return "tail";
      }),
      basicJSON : stringFun(function(head, req) {
        start({"headers":{"Content-Type" : "application/json"}});
        send('{"head":'+toJSON(head)+', ');
        send('"req":'+toJSON(req)+', ');
        send('"rows":[');
        var row, sep = '';
        while (row = getRow()) {
          send(sep + toJSON(row));
          sep = ', ';
        }
        return "]}";
      }),
      simpleForm: stringFun(function(head, req) {
        log("simpleForm");
        send('<ul>');
        var row, row_number = 0, prevKey, firstKey = null;
        while (row = getRow()) {
          row_number += 1;
          if (!firstKey) firstKey = row.key;
          prevKey = row.key;
          send('\n<li>Key: '+row.key
          +' Value: '+row.value
          +' LineNo: '+row_number+'</li>');
        }
        return '</ul><p>FirstKey: '+ firstKey +
          ' LastKey: '+ prevKey+'</p>';
      }),
      acceptSwitch: stringFun(function(head, req) {
        // respondWith takes care of setting the proper headers
        provides("html", function() {
          send("HTML <ul>");

          var row, num = 0;
          while (row = getRow()) {
            num ++;
            send('\n<li>Key: '
              +row.key+' Value: '+row.value
              +' LineNo: '+num+'</li>');
          }

          // tail
          return '</ul>';
        });

        provides("xml", function() {
          send('<feed xmlns="http://www.w3.org/2005/Atom">'
            +'<title>Test XML Feed</title>');

          while (row = getRow()) {
            var entry = new XML('<entry/>');
            entry.id = row.id;
            entry.title = row.key;
            entry.content = row.value;
            send(entry);
          }
          return "</feed>";
        });
      }),
      qsParams: stringFun(function(head, req) {
        return toJSON(req.query) + "\n";
      }),
      stopIter: stringFun(function(req) {
        send("head");
        var row, row_number = 0;
        while(row = getRow()) {
          if(row_number > 2) break;
          send(" " + row_number);
          row_number += 1;
        };
        return " tail";
      }),
      stopIter2: stringFun(function(head, req) {
        provides("html", function() {
          send("head");
          var row, row_number = 0;
          while(row = getRow()) {
            if(row_number > 2) break;
            send(" " + row_number);
            row_number += 1;
          };
          return " tail";
        });
      }),
      tooManyGetRows : stringFun(function() {
        send("head");
        var row;
        while(row = getRow()) {
          send(row.id);
        };
        getRow();
        getRow();
        getRow();
        row = getRow();
        return "after row: "+toJSON(row);
      }),
      emptyList: stringFun(function() {
        return " ";
      }),
      rowError : stringFun(function(head, req) {
        send("head");
        var row = getRow();
        send(fooBarBam); // intentional error
        return "tail";
      }),
      listWithCommonJs: stringFun(function() {
        var lib = require('somelib');
        return lib.type;
      }),
      properties: stringFun(function() {
        start({"headers":{"Content-Type" : "application/json"}});
        return  JSON.stringify(getRow());
      })
    },
    somelib: "exports.type = 'point';"
  };
  var indexOnlyDesignDoc = {
    _id:"_design/indexes",
    language: "javascript",
    spatial : {
      basicIndex : stringFun(function(doc) {
        emit({
          type: "Point",
          coordinates: [doc.loc[0], doc.loc[1]]
        }, doc.string);
      })
    }
  };
  var erlListDoc = {
    _id: "_design/erlang",
    language: "erlang",
    lists: {
        simple:
            'fun(Head, {Req}) -> ' +
            '  Send(<<"[">>), ' +
            '  Fun = fun({Row}, Sep) -> ' +
            '    Val = proplists:get_value(<<"key">>, Row, 23), ' +
            '    Send(list_to_binary(Sep ++ ' +
            '         lists:flatten(io_lib:format("~p", [Val])))), ' +
            '    {ok, ","} ' +
            '  end, ' +
            '  {ok, _} = FoldRows(Fun, ""), ' +
            '  Send(<<"]">>) ' +
            'end.'
    }
  };

  T(db.save(designDoc).ok);

  function makeSpatialDocs(start, end, templateDoc) {
    var docs = makeDocs(start, end, templateDoc);
    for (var i=0; i<docs.length; i++) {
        docs[i].loc = [i-10-docs[i].integer, i+15+docs[i].integer];
    }
    return docs;
  }

  var etag, xhr;
  var url_pre = '/test_suite_db/_design/lists/_spatial/_list/';
  var url_bbox = '?bbox=-180,-90,180,90';
  var docs = makeSpatialDocs(0, 10);
  db.bulkSave(docs);

  // standard get
  xhr = CouchDB.request("GET", url_pre + "basicBasic/basicIndex" + url_bbox);
  T(xhr.status == 200, "standard get should be 200");
  T(/head\d{10}tail/.test(xhr.responseText));

  // test that etags are available
  etag = xhr.getResponseHeader("etag");
  xhr = CouchDB.request("GET", url_pre + "basicBasic/basicIndex" + url_bbox, {
    headers: {"if-none-match": etag}
  });
  T(xhr.status == 304);

  // test the richness of the arguments
  xhr = CouchDB.request("GET", url_pre + "basicJSON/basicIndex" + url_bbox);
  T(xhr.status == 200, "standard get should be 200");
  var resp = JSON.parse(xhr.responseText);
  TEquals(11, resp.head.update_seq);

  T(resp.rows.length == 10);
  T(/"id":"9"/.test(xhr.responseText));
  T(/"value":"9"/.test(xhr.responseText));
  T(/"key":\[\[-10,-10\],\[33,33\]\]/.test(xhr.responseText));
  T(/"geometry":\{"type":"Point","coordinates":\[-10,33\]\}/.test(
    xhr.responseText));


  TEquals(resp.req.info.db_name, "test_suite_db");
  TEquals(resp.req.method, "GET");
  TEquals(resp.req.path, [
      "test_suite_db",
      "_design",
      "lists",
      "_spatial",
      "_list",
      "basicJSON",
      "basicIndex"
  ]);
  T(resp.req.headers.Accept);
  T(resp.req.headers.Host);
  T(resp.req.headers["User-Agent"]);
  T(resp.req.cookie);

/*
  // get with query params
  xhr = CouchDB.request("GET", "/test_suite_db/_design/lists/_list/simpleForm/basicView?startkey=3&endkey=8");
  T(xhr.status == 200, "with query params");
  T(!(/Key: 1/.test(xhr.responseText)));
  T(/FirstKey: 3/.test(xhr.responseText));
  T(/LastKey: 8/.test(xhr.responseText));
*/
  // with 0 rows
  xhr = CouchDB.request("GET", url_pre + "simpleForm/basicIndex?bbox=179,89,180,90");
  T(xhr.status == 200, "0 rows");
  T(/<ul><\/ul>/.test(xhr.responseText));

  //too many Get Rows
  xhr = CouchDB.request("GET", url_pre + "tooManyGetRows/basicIndex" + url_bbox);
  T(xhr.status == 200, "tooManyGetRows");
  T(/after row: null/.test(xhr.responseText));


  // limit and skip tests
  url = url_pre + "basicBasic/basicIndex" + url_bbox;
    xhr = CouchDB.request("GET", url + '&skip=3');
  TEquals(15, xhr.responseText.length, "skip 3");

  xhr = CouchDB.request("GET", url + '&limit=5');
  TEquals(13, xhr.responseText.length, "limit 5");

  xhr = CouchDB.request("GET", url + '&skip=4&limit=3');
  TEquals(11, xhr.responseText.length, "skip 4, limit 3");

  xhr = CouchDB.request("GET", url + '&skip=4&limit=31');
  TEquals(14, xhr.responseText.length, "skip 4, limit > total");

  xhr = CouchDB.request("GET", url + "&skip=1&limit=4");
  // remove "tail"
  resp = xhr.responseText.substring(0,xhr.responseText.length-4);
  TEquals(8, resp.length, "skip 1, limit is 4");
  xhr = CouchDB.request("GET", url + "&skip=5&limit=3");
  var oldResp = resp;
  // remove "head"
  resp = xhr.responseText.substring(4);
  TEquals(7, resp.length, "skip 5, limit is 3");
  var concatenated = oldResp + resp;
  xhr = CouchDB.request("GET", url + "&skip=1&limit=7");
  TEquals(15, xhr.responseText.length, "skip 1, limit is 7");
  TEquals(true, xhr.responseText===concatenated,
    "two concatenated requests are the same as a single one");


  // test that etags are available
  xhr = CouchDB.request("GET", url_pre + "basicBasic/basicIndex" + url_bbox);
  etag = xhr.getResponseHeader("etag");
  xhr = CouchDB.request("GET", url_pre + "basicBasic/basicIndex" + url_bbox, {
    headers: {"if-none-match": etag}
  });
  T(xhr.status == 304);

  // verify the etags expire correctly
  docs = makeSpatialDocs(11, 12);
  db.bulkSave(docs);

  xhr = CouchDB.request("GET", url_pre + "simpleForm/basicIndex" + url_bbox, {
    headers: {"if-none-match": etag}
  });
  T(xhr.status == 200, "etag expire");

  // empty list
  xhr = CouchDB.request("GET", url_pre + "emptyList/basicIndex" + url_bbox);
  T(xhr.responseText.match(/^ $/));

  xhr = CouchDB.request("GET", url_pre + "rowError/basicIndex" + url_bbox);
  T(/ReferenceError/.test(xhr.responseText));

  // now with extra qs params
  xhr = CouchDB.request("GET", url_pre + "qsParams/basicIndex" + url_bbox +
                        "&foo=blam");
  T(xhr.responseText.match(/blam/));

  xhr = CouchDB.request("GET", url_pre + "stopIter/basicIndex" + url_bbox);
  // T(xhr.getResponseHeader("Content-Type") == "text/plain");
  T(xhr.responseText.match(/^head \d \d \d tail$/) && "basic stop");

  xhr = CouchDB.request("GET", url_pre + "stopIter2/basicIndex" + url_bbox, {
    headers : {
      "Accept" : "text/html"
    }
  });
  T(xhr.responseText.match(/^head \d \d \d tail$/) && "stop 2");

  // with accept headers for HTML
  xhr = CouchDB.request("GET", url_pre + "acceptSwitch/basicIndex" + url_bbox, {
    headers: {
      "Accept": 'text/html'
    }
  });
  T(xhr.getResponseHeader("Content-Type") == "text/html; charset=utf-8");
  T(xhr.responseText.match(/HTML/));
  T(xhr.responseText.match(/Value/));

  // now with xml
  xhr = CouchDB.request("GET", url_pre + "/acceptSwitch/basicIndex" + url_bbox, {
    headers: {
      "Accept": 'application/xml'
    }
  });
  T(xhr.getResponseHeader("Content-Type") == "application/xml");
  T(xhr.responseText.match(/XML/));
  T(xhr.responseText.match(/entry/));

  // test with CommonJS module
  xhr = CouchDB.request("GET", url_pre + "listWithCommonJs/basicIndex" + url_bbox);
  T(xhr.status == 200, "standard get should be 200");
  T(/point/.test(xhr.responseText));

  // Test we can run lists and views from separate docs.
  T(db.save(indexOnlyDesignDoc).ok);
  var url = url_pre + "simpleForm/indexes/basicIndex" + url_bbox;
  xhr = CouchDB.request("GET", url);
  T(xhr.status == 200, "multiple design docs.");
  T(/-10,-10,29,29/.test(xhr.responseText));
  T(/-10,-10,33,33/.test(xhr.responseText));
  T(/-21,-21,26,26/.test(xhr.responseText));

  var erlViewTest = function() {
    T(db.save(erlListDoc).ok);
    var url = "/test_suite_db/_design/erlang/_spatial/_list/" +
              "simple/indexes/basicIndex" + url_bbox;
    xhr = CouchDB.request("GET", url);
    T(xhr.status == 200, "multiple languages in design docs.");
    var list = JSON.parse(xhr.responseText);
    T(list.length == 11);
    T(/[-10.0,-10.0],[21.0,21.0]/.test(xhr.responseText));
    T(/[-10.0,-10.0],[31.0,31.0]/.test(xhr.responseText));
    T(/[-21.0,-21.0],[26.0,26.0]/.test(xhr.responseText));
  };

  run_on_modified_server([{
    section: "native_query_servers",
    key: "erlang",
    value: "{couch_native_process, start_link, []}"
  }], erlViewTest);


  // There was a bug within the code path when a parent node MBR is completely
  // within the bbox it is searched for, but only if it's more than 1 level
  // deep. Therefore we need to insert more than 40 docs as the current max
  // limit of a node is 40.
  docs = makeSpatialDocs(20, 70);
  db.bulkSave(docs);
  xhr = CouchDB.request("GET", url_pre + "emptyList/basicIndex" + url_bbox);
  T(xhr.responseText.match(/^ $/));

  // Test if row contains bbox and geometry properties
  xhr = CouchDB.request("GET", url_pre + "properties/basicIndex" + url_bbox);
  T(xhr.status == 200, "properties");
  resp = JSON.parse(xhr.responseText);
  TEquals(2, resp.key.length);
  TEquals(2, resp.key[0].length);
  TEquals("Point", resp.geometry.type);
  TEquals(2, resp.geometry.coordinates.length);
};
