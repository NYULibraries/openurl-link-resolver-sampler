import { AbstractServiceSampler } from './AbstractServiceSampler.js';

export class GetItServiceSampler extends AbstractServiceSampler {
    static #defaultEndpoint = 'https://dev.getit.library.nyu.edu/resolve';

    constructor( testCaseGroup, page, endpointOverride ) {
        super(
            'GetIt',
            'getit',
            testCaseGroup,
            page,
            endpointOverride || GetItServiceSampler.#defaultEndpoint
        );
    }

    async getWaitForPromise() {
        // We have to return different promises for cached and non-cached responses.
        try {
            // Non-cached responses appear to have <script> elements inserted
            // which makes XHR calls back to the server to get HTML chunks.
            // Look for this script, and if it is present, wait for the final
            // XHR call.
            const updaterScript = await this.page.locator( 'div.umlaut-resolve-container script' );
            const script = await updaterScript.textContent();

            // Sample: note that we can't match against this exact string because
            // the umlaut.request_id value changes.
            /*
                //<![CDATA[
                jQuery(document).ready(function ($) {
                  var umlaut_base, context_object, updater;
                  umlaut_base = "https://dev.getit.library.nyu.edu/";
                  context_object = "umlaut.request_id=54052&umlaut.institution=NYU";
                  updater = new Umlaut.HtmlUpdater(umlaut_base, context_object);
                    updater.add_section_target({ umlaut_section_id: "cover_image" });
                    updater.add_section_target({ umlaut_section_id: "search_inside" });
                    updater.add_section_target({ umlaut_section_id: "fulltext" });
                    updater.add_section_target({ umlaut_section_id: "export_citation" });
                    updater.add_section_target({ umlaut_section_id: "related_items" });
                    updater.add_section_target({ umlaut_section_id: "highlighted_link" });
                    updater.add_section_target({ umlaut_section_id: "service_errors" });
                  setTimeout(function () { updater.update(); }, 250.0);
                });
                //]]>
            */

            if ( script.match( /Umlaut.HtmlUpdater/ ) ) {
                return this.page.waitForEvent( 'response', async response => {
                    if ( response.status() === 200 && response.url().startsWith( 'https://dev.getit.library.nyu.edu/resolve/partial_html_sections' ) ) {
                        const responseJson = await response.json();

                        return responseJson.partial_html_sections.complete === 'true';
                    }
                } );
            } else {
                // Hopefully we never get here, but presumably this would be a safe
                // wait-for promise.
                return this.page.waitForLoadState( 'domcontentloaded' );
            }
        } catch ( error ) {
            // Assume that this response is cached, and that there will be no
            // XHR calls, and that the HTML contains the complete list of links.
            return this.page.waitForLoadState( 'domcontentloaded' );
        }
    }
}
