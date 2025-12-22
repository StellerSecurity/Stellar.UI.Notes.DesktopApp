import { TestBed } from '@angular/core/testing';

import { SecretapiService } from './secretapi.service';

describe('SecretapiService', () => {
  let service: SecretapiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SecretapiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
