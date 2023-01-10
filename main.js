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

async function fetchResponseSample( sampler, testCaseUrl, key ) {
    let html;
    let servicesResponseSampleFilePathRelative;

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

    servicesResponseSampleFilePathRelative = sampler.getServiceResponseSampleFilePathRelative( key );
    const serviceResponseSampleFilePathAbsolute = path.join( RESPONSE_SAMPLES_DIR, servicesResponseSampleFilePathRelative );
    if ( !fs.existsSync( path.dirname( serviceResponseSampleFilePathAbsolute ) ) ) {
        fs.mkdirSync( path.dirname( serviceResponseSampleFilePathAbsolute ), { recursive : true } );
    }
    fs.writeFileSync( path.join( RESPONSE_SAMPLES_DIR, servicesResponseSampleFilePathRelative ), html, { encoding : 'utf8' } );

    return servicesResponseSampleFilePathRelative;
}

async function fetchResponseSamples( samplers ) {
    for ( let i = 0; i < testCaseUrls.length; i ++ ) {
        const testCaseUrl = testCaseUrls[ i ];
        const key = getKey( testCaseUrl );

        index[ testCaseUrl ] = {
            key,
            testCaseGroup,
            fetchTimestamp : new Date( Date.now() ).toLocaleString( 'en-US', {
                timeZone : 'America/New_York',
            } ),
        };

        let failed = false;
        for ( let i = 0; i < samplers.length; i++ ) {
            const sampler = samplers[ i ];
            const responseSampleFilePathRelative = await fetchResponseSample( sampler, testCaseUrl, key );
            if ( responseSampleFilePathRelative ) {
                index[ testCaseUrl ][ `${ sampler.serviceName }SampleFile` ] = responseSampleFilePathRelative;
            } else {
                failed = true;
                logger.error( `${ testCaseUrl }: failed to fetch response for ${ sampler.name }` );
            }
        }

        if ( failed ) {
            return;
        }

        logger.info( `${ testCaseUrl }: fetched responses: ${ samplers.map( sampler => sampler.name ).join( ', ' ) }` );

        writeIndex();

        sleepSeconds( 3 );
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

async function initializePlaywright() {
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
}

function parseArgs() {
    return yargs( hideBin( process.argv ) )
        .option( 'ariadne-endpoint', {
            alias       : 'a',
            description : 'Override Ariadne endpoint',
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

    if ( argv.limit ) {
        testCaseUrls = testCaseUrls.slice( 0, argv.limit );
    }

    // Replace existing sample files and index entries?
    if ( ! argv.replace ) {
        const indexUrls = Object.keys( index );
        testCaseUrls = testCaseUrls.filter( testCaseUrl => !indexUrls.includes( testCaseUrl ) );
    }

    await initializePlaywright();

    await fetchResponseSamples(
        [
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
        ]
    );

    browser.close();
}

main();
