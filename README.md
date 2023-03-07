# OpenURL link resolver sampler

See monday.com ticket [Write script for testing sample OpenURLs](https://nyu-lib.monday.com/boards/765008773/pulses/3386819884).
This ticket calls for the creation of two components: a sampler which fetches and saves
the responses from various services to OpenURL queries, and an analyzer which generates
reports comparing the service samples. This project is the sampler component.
The analyzer component is
[openurl\-link\-resolver\-sample\-analyzer](https://github.com/NYULibraries/openurl-link-resolver-sample-analyzer).

# Usage

For the basic usage message, run `main.js --help`:

```shell
$ node main.js --help
Usage: main.js [-a|ariadne-endpoint <Ariadne endpoint>] [-x|--excude <service na
me> [-g|--getit-endpoint <GetIt endpoint>] [--headed] [-l|--limit <number>] [-r|
--replace] [-s|--sfx-endpoint <SFX endpoint>] <random|targeted>

Options:
      --help              Show help                                    [boolean]
      --version           Show version number                          [boolean]
  -a, --ariadne-endpoint  Override Ariadne endpoint                     [string]
  -x, --exclude           Exclude ServiceSampler                        [string]
  -g, --getit-endpoint    Override GetIt endpoint                       [string]
      --headed            Run playwright in "headed" mode              [boolean]
      --limit             Set the number of samples to fetch            [number]
  -r, --replace           Replace existing sample files                [boolean]
  -s, --sfx-endpoint      Override SFX endpoint                         [string]
  -t, --timeout           Set Playwright timeout                        [number]
```

## Examples:

Retrieve samples for all test URLs in the *.txt files in _test-case-files/targeted/_,
saving them in _response-samples/targeted/_ and adding appropriate entries to
_response-samples/targeted/index.json_.  The _targeted/_ subdirectory and the _index.json_
file will be created automatically if they do not already exist.
By default, the sample runs in "resume" mode, meaning it will not retrieve samples
for test URLs that already have entries in _index.json_.

```shell
node main.js targeted
```

To retrieve samples for all test URLs regardless of whether they've already been
retrieved (according to _response-samples/targeted/index.json_), add the `--replace`
flag.  The previous sample files and index entries will be overwritten.

```shell
node main.js --replace targeted
```

To make the Chromium browser used by `playwright` visible, add the `--headed` flag.

```shell
node main.js --headed targeted
```

To override the default timeout of 35,000 milliseconds (35 seconds), add the `--timeout`
flag with new timeout in milliseconds.

```shell
node main.js --timeout 5000 targeted
```

This command will override the default Ariadne endpoint (http://localhost:300/), run `playwright`
in "headed" mode, retrieve a sample for every test URL in _targeted/targeted-getit-test-OpenURLs.txt_
regardless of whether an entry already exists in _response-samples/targeted/index.json_ or not,
and override the default timeout of 300,000 milliseconds (5 minutes):

```shell
node main.js --ariadne-endpoint http://localhost:3001/ --headed --replace --timeout 60000 targeted
```

To exclude the SFX service from the sampling:

```shell
node main.js --exclude sfx --replace targeted
```

The argument to the `--exclude` option is the value of the `.serviceName` field for the service sampler
that is to be excluded.  The service sampler classes are in _lib/classes/_.
Multiple `--exclude` flags are permitted for excluding more than one service.

IMPORTANT: If you plan on analyzing the samples using [openurl\-link\-resolver\-sample\-analyzer](https://github.com/NYULibraries/openurl-link-resolver-sample-analyzer),
you can exclude `sfx`, but you must not exclude either `getit` or `ariadne` services,
as the analyzer requires samples from both services to be present in the `index.json`.

# Creating new test case groups

To make a new test case group, create a new subdirectory in _test-case-files/_
containing *.txt files that have lists of test case URLs of the proper form, one per line.
See the _random/_ and _targeted/_ directories for examples.
Test case URLs must start with "getit.library.nyu.edu/resolve?".  Note that the sampler
currently runs against dev GetIt, not prod, because dev GetIt has been altered
to use actual direct links rather than the usual internal "/link_router/" URLs.
The test case URLs provided by DAI were from the prod GetIt logs, so we standardize
on prod GetIt for the form of the test case OpenURLs. 

The new subdirectory name will automatically be added to the list of valid test
case groups that can be accepted as an argument (and so will appear in usage and
error messages).  As new subdirectory of the same name will be created in the _response-samples/_
directory when the sample run is executed.

# Response samples

Response samples of interest are being stored in a separate repo: [openurl\-link\-resolver\-response\-samples](https://github.com/NYULibraries/openurl-link-resolver-response-samples).

## Test cases

monday.com ticket: [Compile sample OpenURLs to test functionality in Resolve](https://nyu-lib.monday.com/boards/765008773/pulses/3386767625)

The sources for _random/_ and _targeted/_ are the files in this
Google Drive folder: [GetIt Replacement > Test Cases](https://drive.google.com/drive/folders/14HRMxGBCGT7k6xLy8YgFmo7f4CvUNshR)

The source for _random-100/_: ` cat ../random/* | shuf -n 100 > 100-random-nyu-getit-resolve-openurls.txt`

The source for _failed-729/_:

```shell
grep '    "getit.library.nyu.edu/resolve' ../openurl-link-resolver-response-samples/failed-729/index.json | sed 's/^    "//' | sed 's/": {$//' > test-case-files/failed-729/2023-03-03-sampling-run-getit-had-unique-links.txt`
```

...where the `openurl-link-resolver-response-samples` repo had commit
[5b48ad8e278a14c173d6d1e52fc2558f804dc540](https://github.com/NYULibraries/openurl-link-resolver-response-samples/commit/5b48ad8e278a14c173d6d1e52fc2558f804dc540)
checked out.

