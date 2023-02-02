import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import process from 'process';
import { fileURLToPath } from 'url';

import glob from 'glob';
import playwright from 'playwright';
import { createLogger, format, transports } from 'winston';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { AriadneServiceSampler } from './lib/classes/AriadneServiceSampler.js';
import { GetItServiceSampler } from './lib/classes/GetItServiceSampler.js';
import { SfxServiceSampler } from './lib/classes/SfxServiceSampler.js';

// https://stackoverflow.com/questions/64383909/dirname-is-not-defined-in-node-14-version
const __filename = fileURLToPath( import.meta.url );
const __dirname = path.dirname( __filename );

// https://www.stefanjudis.com/snippets/how-to-import-json-files-in-es-modules-node-js/
// See "Option 2: Leverage the CommonJS require function to load JSON files"
import { createRequire } from "module";
const require = createRequire( import.meta.url );

const ROOT_DIR = __dirname;

// Top-level directories
const LOGS_DIR = path.join( ROOT_DIR, 'logs' );
const RESPONSE_SAMPLES_DIR = path.join( ROOT_DIR, 'response-samples' );
const TEST_CASE_FILES_DIR = path.join( ROOT_DIR, 'test-case-files' );

// Test case groups
const TEST_CASE_GROUPS = fs.readdirSync( TEST_CASE_FILES_DIR );

// Files
const INDEX_FILE_NAME = 'index.json';

// Limit number of SFX requests to < 1,000 per hour.  Note that currently all
// samplers generate calls to SFX, which means each sampling generates 3 SFX requests.
// This was originally set to 3 seconds, because a pause of that length in between
// each sampling triplet ensures we make no more than 999 SFX requests per hour.
// In practice, the rate of sampling was not fast enough to warrant any pause
// between sampling triplets at all, so this is now set to zero.
const DEFAULT_SLEEP = 0;

// 5 minutes
const DEFAULT_TIMEOUT = 300_000;

const logger = createLogger(
    {
        level      : 'info',
        format     : format.combine(
            format.timestamp( {
                                  format : 'YYYY-MM-DD HH:mm:ss'
                              } ),
            format.printf( info => `${info.timestamp} ${info.level}: ${info.message}` ),
        ),
        transports : [
            new transports.Console(),
            //
            // - Write all logs with importance level of `error` or less to `error.log`
            // - Write all logs with importance level of `info` or less to `combined.log`
            //
            new transports.File( {
                                     filename : `${LOGS_DIR}/error.log`,
                                     level    : 'error'
                                 } ),
            new transports.File( { filename : `${LOGS_DIR}/combined.log` } ),
        ],
    } );

let index;
let indexFile;
let testCaseGroup;
let testCaseUrls;

// Playwright
let browser;
let headed = false;
let page;

function abort( errorMessage ) {
    console.error( errorMessage );
    usage();
    process.exit( 1 );
}

async function fetchResponseHtml( sampler, testCaseUrl, key ) {
    let html;
    let queryString;
    try {
        // `testCaseUrl` might be missing the URL stuff before the domain name.
        // Prepend whatever to enable the URL constructor to succeed.
        // We only need the query string.
        queryString = new URL( `http://${testCaseUrl}` ).search;
    } catch ( error ) {
        logger.error( `${ testCaseUrl }: ${ error }` );
        return;
    }

    const url = `${ sampler.endpoint }${ queryString }`;

    try {
        html = await sampler.fetchSampleHtml( url );
    } catch ( error ) {
        logger.error( `${ testCaseUrl } | ${ url }: ${ error }` );
        return;
    }

    return html;
}

async function fetchResponseSamples( samplers ) {
    for ( let i = 0; i < testCaseUrls.length; i ++ ) {
        const testCaseUrl = testCaseUrls[ i ];
        const key = getKey( testCaseUrl );

        const indexEntry = {
            key,
            testCaseGroup,
            fetchTimestamp : new Date( Date.now() ).toLocaleString( 'en-US', {
                timeZone : 'America/New_York',
            } ),
            sampleFiles: {},
        };

        let failed = false;
        let html = {};
        // Fetch response HTML for each service
        for ( let i = 0; i < samplers.length; i++ ) {
            const sampler = samplers[ i ];
            const responseHtml = await fetchResponseHtml( sampler, testCaseUrl, key );
            if ( responseHtml ) {
                indexEntry.sampleFiles[ sampler.serviceName ] = sampler.getServiceResponseSampleFilePathRelative( key );
                html[ sampler.serviceName ] = responseHtml;
            } else {
                failed = true;
                logger.error( `${ testCaseUrl }: failed to fetch response for ${ sampler.name }` );
            }
        }

        if ( failed ) {
            continue;
        }

        // Write out sample files
        Object.keys( indexEntry.sampleFiles ).forEach( serviceName => {
            const sampleFile = indexEntry.sampleFiles[ serviceName ];
            const serviceResponseSampleFilePathAbsolute = path.join( RESPONSE_SAMPLES_DIR, sampleFile );
            try {
                if ( ! fs.existsSync( path.dirname( serviceResponseSampleFilePathAbsolute ) ) ) {
                    fs.mkdirSync( path.dirname( serviceResponseSampleFilePathAbsolute ), { recursive : true } );
                }
                fs.writeFileSync( serviceResponseSampleFilePathAbsolute, html[ serviceName ], { encoding : 'utf8' } );
            } catch ( error ) {
                logger.error( `${ testCaseUrl }: failed to write sample file ${ serviceResponseSampleFilePathAbsolute }: ${ error }` );

                failed = true;
            }
        } );

        if ( failed ) {
            logger.error( `${ testCaseUrl }: test group sample directory might be in an inconsistent state` );

            continue;
        }

        logger.info( `${ testCaseUrl }: fetched responses: ${ samplers.map( sampler => sampler.name ).join( ', ' ) }` );

        // Update index
        index[ testCaseUrl ] = indexEntry;
        writeIndex();

        sleepSeconds( DEFAULT_SLEEP );
    }
}

function getIndex() {
    const index = {};
    if ( fs.existsSync( indexFile ) ) {
        const indexFileJson = require( indexFile );
        Object.assign( index, indexFileJson );
    }

    return index;
}

function getKey( testCaseUrl ) {
    return crypto.createHash( 'md5' ).update( testCaseUrl ).digest( 'hex' );
}

function getTestCaseUrls() {
    const testCaseUrls = [];
    const directory = path.join( TEST_CASE_FILES_DIR, testCaseGroup );
    const testCaseFiles = glob.sync( `${directory}/**/*.txt` );

    testCaseFiles.forEach( testCaseFile => {
        const lines = fs.readFileSync( testCaseFile, 'utf-8' );
        lines.split( /\r?\n/ ).forEach( line => {
            if ( line.startsWith( 'getit.library.nyu.edu/resolve?' ) ) {
                testCaseUrls.push( line );
            }
        } );
    } );

    testCaseUrls.sort();

    return testCaseUrls;
}

async function initializePlaywright( timeoutOption ) {
    browser = await playwright.chromium.launch(
        {
            headless: !headed,
        }
    );

    page = await browser.newPage(
        {
            bypassCSP: true,
        }
    );

    const timeout = timeoutOption || DEFAULT_TIMEOUT;

    page.setDefaultTimeout( timeout );
}

function parseArgs() {
    return yargs( hideBin( process.argv ) )
        .option( 'ariadne-endpoint', {
            alias       : 'a',
            description : 'Override Ariadne endpoint',
            type        : 'string',
        } )
        .option( 'exclude', {
            alias       : 'x',
            description : 'Exclude ServiceSampler',
            type        : 'string',
        } )
        .option( 'getit-endpoint', {
            alias       : 'g',
            description : 'Override GetIt endpoint',
            type        : 'string',
        } )
        .option( 'headed', {
            type        : 'boolean',
            description : 'Run playwright in "headed" mode',
        } )
        .option( 'limit', {
            type        : 'number',
            description : 'Set the number of samples to fetch',
        } )
        .option( 'replace', {
            alias       : 'r',
            type        : 'boolean',
            description : 'Replace existing sample files',
        } )
        .option( 'sfx-endpoint', {
            alias       : 's',
            description : 'Override SFX endpoint',
            type        : 'string',
        } )
        .option( 'timeout', {
            alias       : 't',
            description : 'Set Playwright timeout',
            type        : 'number',
        } )
        .check( ( argv, options ) => {
            if ( argv._.length === 1 ) {
                const testCaseGroup = argv._[ 0 ];
                if ( TEST_CASE_GROUPS.includes( testCaseGroup ) ) {
                   return true;
                } else {
                    abort(
                        `"${testCaseGroup}" is not a recognized` +
                        ` test group. Please select from one of the following: ` +
                        TEST_CASE_GROUPS.join( ', ' ) );
                }
            } else {
                abort( `You must specify exactly one test case group.` +
                       ` Please select from one of the following: ` +
                       TEST_CASE_GROUPS.join( ', ' ) );
            }
        } )
        .parse();
}

// Based on "Alternative" in https://www.npmjs.com/package/sleep for Node 9.3 and higher
function sleepSeconds( seconds ) {
    Atomics.wait( new Int32Array( new SharedArrayBuffer( 4 ) ), 0, 0, seconds * 1000 );
}

function writeIndex() {
    fs.writeFileSync( indexFile, JSON.stringify( index, null, '    ' ), { encoding : 'utf8' } );
}

function usage() {
    console.error( `Usage: node main.js [-a|ariadne-endpoint <Ariadne endpoint>] [-g|--getit-endpoint <GetIt endpoint>] [--headed] [-l|--limit <number>] [-r|--replace] [-s|--sfx-endpoint <SFX endpoint>] [${TEST_CASE_GROUPS.join( '|' )}]` );
}

async function main() {
    const argv = parseArgs();

    let ariadneEndpointOverride;
    if ( argv.ariadneEndpoint ) {
        ariadneEndpointOverride = argv.ariadneEndpoint;
    }

    let getItEndpointOverride;
    if ( argv.getitEndpoint ) {
        getItEndpointOverride = argv.getitEndpoint;
    }

    if ( argv.headed ) {
        headed = true;
    }

    let sfxEndpointOverride;
    if ( argv.sfxEndpoint ) {
        sfxEndpointOverride = argv.sfxEndpoint;
    }

    testCaseGroup = argv._[ 0 ];

    indexFile = path.join( RESPONSE_SAMPLES_DIR, testCaseGroup, INDEX_FILE_NAME );

    index = getIndex();

    testCaseUrls = getTestCaseUrls();

    // Replace existing sample files and index entries?
    if ( ! argv.replace ) {
        const indexUrls = Object.keys( index );
        testCaseUrls = testCaseUrls.filter( testCaseUrl => !indexUrls.includes( testCaseUrl ) );
    }

    if ( argv.limit ) {
        testCaseUrls = testCaseUrls.slice( 0, argv.limit );
    }

    await initializePlaywright( argv.timeout );

    let serviceSamplers = [
        new GetItServiceSampler(
            testCaseGroup,
            page,
            getItEndpointOverride,
        ),
        new SfxServiceSampler(
            testCaseGroup,
            page,
            sfxEndpointOverride,
        ),
        new AriadneServiceSampler(
            testCaseGroup,
            page,
            ariadneEndpointOverride,
        ),
    ];

    if ( argv.exclude ) {
        const exclude = ( Array.isArray( argv.exclude ) ? argv.exclude.slice() : [ argv.exclude ] )
            .map( element => element.toLowerCase() );
        serviceSamplers = serviceSamplers.filter( serviceSampler => {
            return ! exclude.includes( serviceSampler.serviceName );
        } );
    }

    // Note that the order of the samplers in the array arg is the same order in
    // which Playwright will serially run them to get their respective sample responses.
    await fetchResponseSamples( serviceSamplers );

    browser.close();
}

main();
