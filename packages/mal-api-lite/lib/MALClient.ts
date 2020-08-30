import got, { Options as GotOptions, Got } from 'got';

import { URL } from 'url';
import { PaginatableRequest, BaseRequest } from './RequestInterface';
import { randomBytes } from 'crypto';

export interface Options {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  gotOptions?: GotOptions;
  gotOAuthOptions?: GotOptions;
  autoRefreshAccessToken?: boolean;
}

export class MALClient {
  public clientId?: string;

  public clientSecret?: string;

  public accessToken?: string;

  public refreshToken?: string;

  public got: Got;

  public gotOAuth: Got;

  public PKCEChallangeGenerateSize: number = 32;

  public autoRefreshAccessToken: boolean;



  /**
   * Create MAL API Client
   *
   * @param param0 Your trusty configuration
   */
  public constructor({ clientId, clientSecret, accessToken, refreshToken, gotOptions, gotOAuthOptions, autoRefreshAccessToken = false }: Options) {
    if ((!clientSecret || !clientId) && !(accessToken || refreshToken)) {
      // if either ( clientSecret or clientId ) not preset, AND accessToken or
      // refreshToken is provided...
      throw new Error(
        'either you provide both (`clientSecret` and `clientId`) OR one of (`accessToken` or `refreshToken`)',
      );
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.autoRefreshAccessToken = autoRefreshAccessToken;

    this.got = got.extend({
      ...{
        prefixUrl: 'https://api.myanimelist.net/v2/',
        responseType: 'json',
        hooks: {
          beforeRequest: [
            (options) => {
              options.headers.authorization = ["Bearer", this.accessToken].join(" ");
            }
          ]
        }
      },
      ...gotOptions,
    });
    this.gotOAuth = got.extend({
      ...{
        prefixUrl: 'https://myanimelist.net/v1/oauth2/',
        responseType: 'json',
      },
      ...gotOAuthOptions,
    });
  }



  /**
   * Get Access Token & Refresh Token from given Authorization Code.
   *
   * @param authCode Authorization code
   * @param codeVerifier PKCE Code Challenge
   * @param redirectUri Redirect url, specified on on previous step
   */
  public async resolveAuthCode(authCode: string, codeVerifier: string, redirectUri?: string): Promise<any> {
    if (!this.clientSecret || !this.clientId) {
      throw new Error('clientSecret and clientId must be filled to use this function!');
    }

    const resp: any = await this.gotOAuth.post('token', {
      form: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    });
    const { access_token, refresh_token } = resp.body;
    this.accessToken = access_token;
    this.refreshToken = refresh_token;
    return resp.body;
  }



  /**
   * Generate OAuth URL to gain access to user account on MyAnimeList platform.
   * Will require clientId and clientSecret from custructor.
   *
   * @param codeChallenge PKCE Code Challenge
   * @param redirectUri If you have more than one Redirect URL, please specify
   * the url you use.
   * @param state Your app state
   * @param codeChallengeMethod Only accept "plain". Don't change unless you know
   * what you're doing!
   */
  public getOAuthURL(
    redirectUri?: string,
    codeChallenge?: string,
    state?: string,
  ): { url: string; codeChallenge: string; state?: string } {
    if (!this.clientSecret || !this.clientId) {
      throw new Error('clientSecret and clientId must be filled to use this function!');
    }

    if (!codeChallenge) {
      codeChallenge = randomBytes(this.PKCEChallangeGenerateSize).toString();
    }

    const query: any = {
      response_type: 'code',
      client_id: this.clientId,
      state,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'plain',
    };

    const urlBuilder = new URL('authorize', this.gotOAuth.defaults.options.prefixUrl);
    Object.keys(query).forEach((key) => {
      if (query[key]) {
        urlBuilder.searchParams.append(key, query[key]);
      }
    });

    return { url: urlBuilder.toString(), codeChallenge, state };
  }



  /**
   * Refresh your access token with refresh token. Sounds amazing, right?
   *
   * @param refreshToken Custom refresh token
   */
  public async resolveRefreshToken(refreshToken?: string): Promise<any> {
    if (!refreshToken) {
      refreshToken = this.refreshToken;
    }
    const resp: any = await this.gotOAuth.post('token', {
      form: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    });
    const { access_token, refresh_token } = resp.body;
    this.accessToken = access_token;
    this.refreshToken = refresh_token;
    return resp.body;
  }



  /**
   * Checks for request requirements, such as refresh tokens checkings.
   *
   * @return {boolean} wether we DON'T use refresh token or yes.
   */
  protected async preRequest(): Promise<boolean> {
    if (!this.accessToken) {
      if (!this.autoRefreshAccessToken) {
        throw new Error('accessToken must be filled to use this function while autoRefreshAccessToken is turned off!');
      }
      if (!this.refreshToken) {
        throw new Error('accessToken and/or refreshToken must be filled to use this function!');
      }

      await this.resolveRefreshToken();
      return false;
    }
    return true;
  }



  /**
   * Do HTTP GET stuffs.
   *
   * @param resource Url to call
   * @param param Parameter body
   */
  public async get<T = any>(resource: string, param?: PaginatableRequest): Promise<T> {
    const viaRefreshToken = !(await this.preRequest());

    if (param?.fields && Array.isArray(param.fields)) {
      param.fields = param.fields.join(",");
    }

    const response = await this.got.get<T>(resource, {
      searchParams: param,
    });

    if (response.statusCode === 401 && !viaRefreshToken) {
      // attempt to request the access token, then rerequest;
      if (!this.refreshToken) {
        return response.body;
      }
      this.accessToken = undefined;
      return this.get(resource, param);
    }

    return response.body;
  }



  /**
   * Do HTTP POST stuffs.
   *
   * @param resource Url to call
   * @param param Parameter body
   */
  public async post<T = any>(resource: string, param?: BaseRequest): Promise<T> {
    await this.preRequest();
    const response = await this.got.patch<T>(resource, {
      form: param,
    });
    return response.body;
  }



  /**
   * Do HTTP PATCH stuffs.
   *
   * @param resource Url to call
   * @param param Parameter body
   */
  public async patch<T = any>(resource: string, param?: BaseRequest): Promise<T> {
    await this.preRequest();
    const response = await this.got.patch<T>(resource, {
      form: param,
    });
    return response.body;
  }



  /**
   * Do HTTP PUT stuffs.
   *
   * @param resource Url to call
   * @param param Parameter body
   */
  public async put<T = any>(resource: string, param?: BaseRequest): Promise<T> {
    await this.preRequest();
    const response = await this.got.put<T>(resource, {
      form: param,
    });
    return response.body;
  }



  /**
   * Do HTTP DELETE stuffs.
   *
   * @param resource Url to call
   * @param param Parameter body (discouraged)
   */
  public async delete(resource: string, param?: BaseRequest): Promise<any> {
    await this.preRequest();
    const response = await this.got.delete(resource, {
      searchParams: param,
    });
    return response.body;
  }
}
