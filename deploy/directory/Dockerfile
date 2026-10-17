# vlab-directory: the optional bundled directory (Samba AD DC) for sites without Active Directory.
# The portal account becomes the desktop account: the engine makes, disables and deletes the same
# account here and writes the password the user sets. docs: deploy/README.md "내장 디렉터리"
#
# Debian 12 ships Samba 4.17 (AD DC with the internal DNS). Linux desktops join with realm/SSSD and
# SSSD's id mapping (uid/gid from the SID, the same on every desktop) - no RFC2307 attributes needed.

FROM debian:12.8-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends samba winbind krb5-user ldb-tools smbclient dnsutils \
        ca-certificates procps \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /etc/samba/smb.conf
COPY entrypoint.sh /usr/local/bin/vlab-directory
# a checkout made on Windows has CRLF line ends
RUN sed -i 's/\r$//' /usr/local/bin/vlab-directory && chmod 755 /usr/local/bin/vlab-directory
# 53 DNS, 88 Kerberos, 135 + 49152-49200 RPC (join of a second DC, Windows tools), 389/636 LDAP(S),
# 445 SMB (sign-in, SYSVOL), 464 kpasswd, 3268/3269 global catalog
EXPOSE 53/tcp 53/udp 88/tcp 88/udp 135/tcp 389/tcp 389/udp 445/tcp 464/tcp 464/udp 636/tcp 3268/tcp 3269/tcp
VOLUME ["/var/lib/samba"]
ENTRYPOINT ["/usr/local/bin/vlab-directory"]
