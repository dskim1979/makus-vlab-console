#!/bin/sh
# vlab-directory start: provision the domain on the first start (or join it as a second DC),
# then run samba in the foreground. Everything lives in /var/lib/samba (the vlab-directory volume);
# /vlab (the vlab-directory-out volume, read-only in the engine) gets what the engine needs:
#   engine-bind   the password of the engine's service account vlab-svc (primary only)
#   ca.pem        the DC's own TLS CA, so the engine checks the LDAPS certificate
#
# Layout the engine relies on (pegaprox/vlab/directory.py):
#   OU=MOAVI,<base>                     vlab-svc has full control here and nowhere else
#     OU=Users     portal accounts      (the only place portal sign-in looks)
#     OU=Groups    moavi-users + one group per department
#     OU=Desktops  joined desktops      vlab-join may create / reset computers here only
#     OU=Service   vlab-svc, vlab-join
set -eu

REALM_LC=$(printf %s "${VLAB_DIRECTORY_REALM:-moavi.lan}" | tr 'A-Z' 'a-z')
REALM=$(printf %s "$REALM_LC" | tr 'a-z' 'A-Z')
DOMAIN=$(printf %s "${VLAB_DIRECTORY_DOMAIN:-MOAVI}" | tr 'a-z' 'A-Z')
HOST=$(printf %s "${VLAB_DIRECTORY_HOSTNAME:-dc1}" | tr 'A-Z' 'a-z')
ROLE=${VLAB_DIRECTORY_ROLE:-primary}
IP=${VLAB_DIRECTORY_IP:-}
FORWARDER=${VLAB_DIRECTORY_DNS_FORWARDER:-127.0.0.11}
STATE=/var/lib/samba
OUT=/vlab
BASE=$(printf %s "$REALM_LC" | sed 's/^/DC=/; s/\./,DC=/g')
MOAVI="OU=MOAVI,$BASE"
OPTS="acl_xattr:security_acl_name=user.NTACL"   # NT ACLs in user.* xattrs: no CAP_SYS_ADMIN needed

log() { echo "vlab-directory: $*"; }
die() { echo "vlab-directory: $*" >&2; exit 1; }

printf %s "$DOMAIN" | grep -Eq '^[A-Z][A-Z0-9-]{0,14}$' || die "VLAB_DIRECTORY_DOMAIN: 1-15 letters, digits or '-' (NetBIOS name), got '$DOMAIN'"
printf %s "$REALM_LC" | grep -Eq '^[a-z0-9-]+(\.[a-z0-9-]+)+$' || die "VLAB_DIRECTORY_REALM: a DNS name like moavi.lan, got '$REALM_LC'"
printf %s "$HOST" | grep -Eq '^[a-z][a-z0-9-]{0,14}$' || die "VLAB_DIRECTORY_HOSTNAME: 1-15 letters, digits or '-', got '$HOST'"
[ "$(printf %s "$REALM_LC" | cut -d. -f1 | tr 'a-z' 'A-Z')" != "$HOST" ] || die "the DC host name must differ from the domain"
[ -n "$IP" ] || die "VLAB_DIRECTORY_IP: the address the desktops reach this DC at (the host's address on the desktop network)"

mkdir -p "$STATE/etc" "$STATE/private" "$OUT"
chmod 755 "$OUT"
# smb.conf lives in the volume, /etc/samba points at it
ln -sfn "$STATE/etc/smb.conf" /etc/samba/smb.conf

secret() {   # a random password the domain's complexity rule accepts
    printf '%s' "$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-20)Aa1!"
}

admin_password() {
    f="$STATE/private/vlab-admin-password"
    if [ -n "${VLAB_DIRECTORY_ADMIN_PASSWORD:-}" ]; then
        printf %s "$VLAB_DIRECTORY_ADMIN_PASSWORD"
    elif [ -s "$f" ]; then
        cat "$f"
    else
        [ "$ROLE" = primary ] || die "VLAB_DIRECTORY_ADMIN_PASSWORD: the primary DC's Administrator password is needed to join it"
        p=$(secret); umask 077; printf %s "$p" > "$f"; printf %s "$p"
    fi
}

tune_conf() {   # our [global] lines, written again at every start (idempotent)
    conf="$STATE/etc/smb.conf"
    sed -i '/# vlab begin/,/# vlab end/d; /^[[:space:]]*dns forwarder[[:space:]]*=/d' "$conf"
    awk -v ins="# vlab begin\n\tdns forwarder = $FORWARDER\n\trpc server dynamic port range = 49152-49200\n\tdns update command = /usr/sbin/samba_dnsupdate --use-samba-tool --current-ip=$IP\n\tldap server require strong auth = yes\n\ttls enabled = yes\n\t$OPTS\n# vlab end" \
        '{print} /^\[global\]/{print ins}' "$conf" > "$conf.new" && mv "$conf.new" "$conf"
}

sid_of() {
    ldbsearch -H "$STATE/private/sam.ldb" "(sAMAccountName=$1)" objectSid 2>/dev/null | awk '/^objectSid:/{print $2; exit}'
}

ou_add() { samba-tool ou add "$1" >/dev/null 2>&1 || samba-tool ou create "$1" >/dev/null 2>&1 || true; }

setup_primary() {   # once, after the domain is made; each step may be run again
    log "setting up OU=MOAVI, the service accounts and the domain password rules"
    # the portal's own password policy decides; the domain only refuses nothing the portal allowed
    samba-tool domain passwordsettings set --complexity=off --history-length=0 --min-pwd-length=8 \
        --min-pwd-age=0 --max-pwd-age=0 --account-lockout-threshold=0 >/dev/null
    for ou in "$MOAVI" "OU=Users,$MOAVI" "OU=Groups,$MOAVI" "OU=Desktops,$MOAVI" "OU=Service,$MOAVI"; do ou_add "$ou"; done
    samba-tool group add moavi-users --groupou="OU=Groups,OU=MOAVI" \
        --description="MOAVI Desk: every portal account" >/dev/null 2>&1 || true
    svc=$(secret)
    if samba-tool user show vlab-svc >/dev/null 2>&1; then
        samba-tool user setpassword vlab-svc --newpassword="$svc" >/dev/null
    else
        samba-tool user create vlab-svc "$svc" --userou="OU=Service,OU=MOAVI" \
            --description="MOAVI Desk engine: manages OU=MOAVI" >/dev/null
    fi
    samba-tool user setexpiry vlab-svc --noexpiry >/dev/null
    # the join account; the engine sets its password itself (sealed in its DB) and may renew it
    if ! samba-tool user show vlab-join >/dev/null 2>&1; then
        samba-tool user create vlab-join "$(secret)" --userou="OU=Service,OU=MOAVI" \
            --description="MOAVI Desk: joins desktops to OU=Desktops" >/dev/null
    fi
    samba-tool user setexpiry vlab-join --noexpiry >/dev/null
    s=$(sid_of vlab-svc); j=$(sid_of vlab-join)
    [ -n "$s" ] && [ -n "$j" ] || die "cannot read the SIDs of vlab-svc / vlab-join"
    # vlab-svc: full control of OU=MOAVI and below (users, groups, computers, passwords)
    samba-tool dsacl set -H "$STATE/private/sam.ldb" --objectdn="$MOAVI" --sddl="(A;CI;GA;;;$s)" >/dev/null
    # vlab-join: create / delete computer objects in OU=Desktops, and full control of those computers
    samba-tool dsacl set -H "$STATE/private/sam.ldb" --objectdn="OU=Desktops,$MOAVI" \
        --sddl="(OA;CI;CCDC;bf967a86-0de6-11d0-a285-00aa003049e2;;$j)" >/dev/null
    samba-tool dsacl set -H "$STATE/private/sam.ldb" --objectdn="OU=Desktops,$MOAVI" \
        --sddl="(OA;CIIO;GA;;bf967a86-0de6-11d0-a285-00aa003049e2;$j)" >/dev/null
    umask 022
    printf %s "$svc" > "$OUT/engine-bind.new" && chmod 644 "$OUT/engine-bind.new" && mv "$OUT/engine-bind.new" "$OUT/engine-bind"
    touch "$STATE/private/vlab-setup-done"
}

if [ ! -f "$STATE/private/sam.ldb" ]; then
    rm -f "$STATE/etc/smb.conf"
    ADMIN_PW=$(admin_password)
    if [ "$ROLE" = primary ]; then
        log "making the domain $REALM ($DOMAIN), DC $HOST.$REALM_LC at $IP"
        samba-tool domain provision --realm="$REALM" --domain="$DOMAIN" --server-role=dc \
            --dns-backend=SAMBA_INTERNAL --use-rfc2307 --host-name="$HOST" --host-ip="$IP" \
            --adminpass="$ADMIN_PW" --option="$OPTS" --option="dns forwarder = $FORWARDER" \
            --targetdir="$STATE" >/dev/null
    elif [ "$ROLE" = replica ]; then
        PRIMARY=${VLAB_DIRECTORY_PRIMARY_IP:-}
        [ -n "$PRIMARY" ] || die "VLAB_DIRECTORY_PRIMARY_IP: the primary DC's address (a second DC joins it)"
        log "joining $REALM as a second DC $HOST.$REALM_LC (primary at $PRIMARY)"
        printf 'nameserver %s\n' "$PRIMARY" > /etc/resolv.conf
        printf '[libdefaults]\n\tdefault_realm = %s\n\tdns_lookup_kdc = true\n' "$REALM" > /etc/krb5.conf
        samba-tool domain join "$REALM_LC" DC --server="$PRIMARY" -U"$DOMAIN\\Administrator" --password="$ADMIN_PW" \
            --dns-backend=SAMBA_INTERNAL --option="$OPTS" --option="netbios name = $(printf %s "$HOST" | tr 'a-z' 'A-Z')" \
            --option="dns forwarder = $FORWARDER" --targetdir="$STATE" >/dev/null
    else
        die "VLAB_DIRECTORY_ROLE: primary or replica, got '$ROLE'"
    fi
    # provision --targetdir writes the conf beside the data: keep it where /etc/samba points
    [ -f "$STATE/etc/smb.conf" ] || die "no smb.conf after provisioning"
fi

cp "$STATE/private/krb5.conf" /etc/krb5.conf 2>/dev/null || true
tune_conf
if [ "$ROLE" = primary ] && [ ! -f "$STATE/private/vlab-setup-done" ]; then
    setup_primary
fi

# the TLS CA samba makes on its first start, for the engine's certificate check
(
    i=0
    while [ $i -lt 120 ]; do
        if [ -s "$STATE/private/tls/ca.pem" ]; then
            cp "$STATE/private/tls/ca.pem" "$OUT/ca.pem.new" && chmod 644 "$OUT/ca.pem.new" && mv "$OUT/ca.pem.new" "$OUT/ca.pem"
            exit 0
        fi
        i=$((i + 1)); sleep 2
    done
    echo "vlab-directory: no TLS CA after 4 minutes - the engine cannot check the certificate" >&2
) &

log "starting samba ($ROLE)"
exec samba --foreground --no-process-group --debug-stdout
